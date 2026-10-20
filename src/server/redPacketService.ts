import crypto from 'crypto';
import {
  db,
  type RedPacketRecord,
  type RedPacketClaimRecord,
  type UserRecord,
} from './db.ts';
import { escrowSigner } from './escrowSigner.ts';
import { normalizeNimiqAddress } from '../../packages/shared/index.ts';

let eventBroadcaster: ((event: string, payload: any) => void) | null = null;
export function setRedPacketEventBroadcaster(fn: (event: string, payload: any) => void) {
  eventBroadcaster = fn;
}

export interface ClaimRedPacketResult {
  success: boolean;
  error?: string;
  statusCode?: number;
  claim?: RedPacketClaimRecord;
  redPacket?: Omit<RedPacketRecord, 'preallocatedAmounts'>;
  newBalanceNim?: number;
  message?: string;
}

/**
 * Atomically claims a share of a Red Packet for a user.
 * Credits the user's wallet balance and dispatches to on-chain network / testnet faucet.
 */
export async function claimRedPacketForUser(
  packetOrSlug: string | RedPacketRecord,
  user: UserRecord,
  ip: string = '127.0.0.1'
): Promise<ClaimRedPacketResult> {
  const packet =
    typeof packetOrSlug === 'string'
      ? db.state.redPackets.find((p) => p.slug === packetOrSlug || p.id === packetOrSlug)
      : packetOrSlug;

  if (!packet) {
    return {
      success: false,
      error: 'Red Packet not found',
      statusCode: 404,
      message: '❌ Red Packet was not found. Please verify the code or link.',
    };
  }

  const cleanUserAddr = normalizeNimiqAddress(user.address);

  return await db.withLock(`redpacket:${packet.id}`, async () => {
    if (packet.status !== 'ACTIVE') {
      return {
        success: false,
        error: `Red Packet is ${packet.status}`,
        statusCode: 400,
        message: `⚠️ This Red Packet is currently ${packet.status.toLowerCase()}.`,
      };
    }

    if (Date.now() >= new Date(packet.expiresAt).getTime()) {
      packet.status = 'EXPIRED';
      return {
        success: false,
        error: 'Red Packet has expired',
        statusCode: 400,
        message: '⏳ This Red Packet has expired.',
      };
    }

    // Enforce unique constraint on (packetId, claimerAddress) and (packetId, userId)
    const alreadyClaimed = packet.claims.find(
      (c) =>
        normalizeNimiqAddress(c.claimerAddress) === cleanUserAddr ||
        c.userId === user.id
    );
    if (alreadyClaimed) {
      return {
        success: false,
        error: 'You have already claimed a share from this Red Packet.',
        statusCode: 409,
        claim: alreadyClaimed,
        message: `ℹ️ You have already claimed ${alreadyClaimed.amountNim} $NIM from this Red Packet!`,
      };
    }

    const slotIndex = packet.claims.length;
    if (slotIndex >= packet.slots) {
      packet.status = 'FINISHED';
      return {
        success: false,
        error: 'All Red Packet shares have been claimed!',
        statusCode: 400,
        message: '🧧 All shares for this Red Packet have already been claimed!',
      };
    }

    const shareLuna = packet.preallocatedAmounts[slotIndex];
    const amountNim = Number((shareLuna / 100_000).toFixed(5));

    const payoutTx = await escrowSigner.sendNim(
      user.address,
      amountNim,
      `rp_claim_${packet.id}_${user.id}`
    );

    const claimRecord: RedPacketClaimRecord = {
      id: `clm_${crypto.randomBytes(6).toString('hex')}`,
      packetId: packet.id,
      claimerAddress: user.address,
      userId: user.id,
      claimerName: user.realName || user.address.slice(0, 12),
      amountNim,
      payoutTxHash: payoutTx.txHash,
      status: 'PAID',
      createdAt: new Date().toISOString(),
    };

    packet.claims.push(claimRecord);
    if (packet.claims.length >= packet.slots) {
      packet.status = 'FINISHED';
    }

    db.state.ledger.unshift({
      id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
      type: 'REDPACKET_PAYOUT',
      refType: 'REDPACKET',
      refId: packet.id,
      amountNim,
      fromAddress: payoutTx.fromAddress,
      toAddress: payoutTx.toAddress,
      txHash: payoutTx.txHash,
      blockHeight: payoutTx.blockHeight,
      createdAt: payoutTx.timestamp,
    });

    db.logAudit(
      user.id,
      user.realName || user.address,
      'REDPACKET_CLAIMED',
      'RedPacket',
      packet.id,
      { amountNim, txHash: payoutTx.txHash },
      ip
    );

    // Really credit the user's wallet with the claimed NIM!
    const newBalanceNim = db.adjustUserBalance(user.id, amountNim);
    db.adjustUserBalance(user.address, 0);

    // If the recipient's wallet is on Nimiq testnet / Nimiq Pay, tap the testnet faucet to deliver real on-chain NIM to their address
    try {
      fetch('https://faucet.pos.nimiq-testnet.com/tapit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `address=${encodeURIComponent(user.address)}`,
      }).catch(() => {});
    } catch {
      // Ignore network errors on third-party faucet
    }

    if (eventBroadcaster) {
      eventBroadcaster('WALLET_BALANCE_UPDATED', {
        userId: user.id,
        address: user.address,
        newBalanceNim,
      });
      eventBroadcaster('REDPACKET_UPDATED', { slug: packet.slug });
    }

    const { preallocatedAmounts, ...safePacket } = packet;

    const shortAddr =
      user.address.length > 14
        ? `${user.address.slice(0, 4)}…${user.address.slice(-4)}`
        : user.address;

    return {
      success: true,
      claim: claimRecord,
      redPacket: safePacket,
      newBalanceNim,
      message: `🎉 Red Packet Opened!\n\nYou received +${amountNim} $NIM from ${packet.creatorName}!\n“${packet.message}”\n\n💰 Deposited directly into your $NIM wallet (${shortAddr})\nNew Balance: ${newBalanceNim} $NIM`,
    };
  });
}
