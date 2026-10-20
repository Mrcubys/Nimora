import crypto from 'crypto';
import { db, type OrderMessageRecord } from './db.ts';
import { escrowSigner } from './escrowSigner.ts';

export type RealtimeBroadcastFn = (event: string, payload: unknown) => void;

let broadcastCallback: RealtimeBroadcastFn | null = null;

export function registerWorkerBroadcast(fn: RealtimeBroadcastFn): void {
  broadcastCallback = fn;
}

function emitEvent(event: string, payload: unknown): void {
  if (broadcastCallback) {
    broadcastCallback(event, payload);
  }
}

export function createSystemOrderMessage(
  orderId: string,
  body: string
): OrderMessageRecord {
  const msg: OrderMessageRecord = {
    id: `msg_${crypto.randomBytes(6).toString('hex')}`,
    orderId,
    senderId: null,
    senderName: 'System',
    type: 'SYSTEM',
    body,
    readAt: null,
    reported: false,
    createdAt: new Date().toISOString(),
  };
  db.state.messages.push(msg);
  emitEvent('ORDER_MESSAGE', { orderId, message: msg });
  return msg;
}

/**
 * Runs every 10 seconds to enforce:
 * 1. AWAITING_DEPOSIT -> 30-min timeout -> CANCELLED (SELLER_NO_DEPOSIT), restore ad liquidity
 * 2. AWAITING_PAYMENT / CRYPTO_LOCKED -> 30-min timeout -> CANCELLED (BUYER_NO_PAYMENT), auto-refund seller from escrow + LedgerEntry
 * 3. PAYMENT_SUBMITTED -> 30-min silence -> DISPUTED (never auto-cancelled or auto-released)
 * 4. RedPacket PENDING_DEPOSIT (30m) or ACTIVE (24h expiry) -> auto-refund unclaimed balance
 * 5. PaymentRequest OPEN -> 24h expiry -> EXPIRED
 */
export async function runTimeoutAndExpiryWorkers(): Promise<void> {
  const now = Date.now();

  // 1. Check P2P Orders
  for (const order of db.state.orders) {
    if (order.status === 'AWAITING_DEPOSIT') {
      const deadline = new Date(order.depositDeadline).getTime();
      if (now >= deadline) {
        await db.withLock(`order:${order.id}`, async () => {
          if (order.status !== 'AWAITING_DEPOSIT') return;
          order.status = 'CANCELLED';
          order.cancelReason = 'SELLER_NO_DEPOSIT';
          order.updatedAt = new Date().toISOString();

          // Restore ad liquidity
          const ad = db.state.ads.find((a) => a.id === order.adId);
          if (ad) {
            ad.availableNim += order.amountNim;
          }

          // Increment seller no-show counter
          const seller = db.state.users.find((u) => u.id === order.sellerId);
          if (seller) {
            seller.noShowCount += 1;
          }

          createSystemOrderMessage(
            order.id,
            'Order auto-cancelled: Seller did not lock NIM into escrow within the 30-minute window (SELLER_NO_DEPOSIT).'
          );
          db.logAudit(
            'system_worker',
            'Timeout Worker',
            'ORDER_AUTO_CANCELLED_NO_DEPOSIT',
            'P2POrder',
            order.id,
            { cancelReason: 'SELLER_NO_DEPOSIT', amountNim: order.amountNim }
          );
          emitEvent('ORDER_UPDATED', order);
        });
      }
    } else if (
      (order.status === 'AWAITING_PAYMENT' || order.status === 'CRYPTO_LOCKED') &&
      order.paymentDeadline
    ) {
      const deadline = new Date(order.paymentDeadline).getTime();
      if (now >= deadline) {
        await db.withLock(`order:${order.id}`, async () => {
          if (
            order.status !== 'AWAITING_PAYMENT' &&
            order.status !== 'CRYPTO_LOCKED'
          ) {
            return;
          }

          // Buyer did not upload payment proof within 30m -> Auto-cancel and refund seller from escrow
          if (!escrowSigner.isPaused()) {
            const refundRes = await escrowSigner.sendNim(
              order.sellerAddress,
              order.amountNim,
              `refund_timeout_${order.id}`
            );
            order.refundTxHash = refundRes.txHash;

            db.state.ledger.unshift({
              id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
              type: 'ESCROW_REFUND',
              refType: 'ORDER',
              refId: order.id,
              amountNim: order.amountNim,
              fromAddress: refundRes.fromAddress,
              toAddress: refundRes.toAddress,
              txHash: refundRes.txHash,
              blockHeight: refundRes.blockHeight,
              createdAt: refundRes.timestamp,
            });
            db.adjustUserBalance(order.sellerId, order.amountNim);
          }

          order.status = 'CANCELLED';
          order.cancelReason = 'BUYER_NO_PAYMENT';
          order.updatedAt = new Date().toISOString();

          const ad = db.state.ads.find((a) => a.id === order.adId);
          if (ad) {
            ad.availableNim += order.amountNim;
          }

          const buyer = db.state.users.find((u) => u.id === order.buyerId);
          if (buyer) {
            buyer.noShowCount += 1;
          }

          createSystemOrderMessage(
            order.id,
            `Order auto-cancelled: Buyer did not submit fiat payment proof within 30 minutes (BUYER_NO_PAYMENT). Escrowed ${order.amountNim} NIM automatically refunded to seller.`
          );
          db.logAudit(
            'system_worker',
            'Timeout Worker',
            'ORDER_AUTO_CANCELLED_NO_PAYMENT',
            'P2POrder',
            order.id,
            {
              cancelReason: 'BUYER_NO_PAYMENT',
              refundTxHash: order.refundTxHash,
              amountNim: order.amountNim,
            }
          );
          emitEvent('ORDER_UPDATED', order);
        });
      }
    } else if (order.status === 'PAYMENT_SUBMITTED' && order.confirmDeadline) {
      const deadline = new Date(order.confirmDeadline).getTime();
      if (now >= deadline) {
        await db.withLock(`order:${order.id}`, async () => {
          if (order.status !== 'PAYMENT_SUBMITTED') return;

          // Section 10.2: Never auto-cancel or auto-release after proof is submitted. Escalate to DISPUTED.
          order.status = 'DISPUTED';
          order.updatedAt = new Date().toISOString();

          const disputeId = `dsp_${crypto.randomBytes(6).toString('hex')}`;
          db.state.disputes.unshift({
            id: disputeId,
            orderId: order.id,
            openedById: 'system_worker',
            openedByName: 'Auto-Escalation Guard',
            reason:
              'Seller did not confirm payment within 30 minutes after buyer uploaded proof. Escrowed NIM remains frozen for admin review.',
            evidence: {
              notes: 'Automatic 30-minute confirmation window expired after PAYMENT_SUBMITTED.',
              reportedMessageIds: [],
              paymentProofUrl: order.paymentProofUrl,
            },
            status: 'OPEN',
            adminId: null,
            resolutionNote: null,
            resolvedAt: null,
            createdAt: new Date().toISOString(),
          });

          createSystemOrderMessage(
            order.id,
            'Seller confirmation window (30 min) expired after payment proof was submitted. Order automatically escalated to DISPUTED. Escrowed NIM stays frozen for admin review.'
          );
          db.logAudit(
            'system_worker',
            'Timeout Worker',
            'ORDER_AUTO_DISPUTE_ESCALATED',
            'P2POrder',
            order.id,
            { disputeId }
          );
          emitEvent('ORDER_UPDATED', order);
        });
      }
    }
  }

  // 2. Check Red Packets
  for (const packet of db.state.redPackets) {
    if (packet.status === 'ACTIVE') {
      const expiresAt = new Date(packet.expiresAt).getTime();
      if (now >= expiresAt) {
        await db.withLock(`redpacket:${packet.id}`, async () => {
          if (packet.status !== 'ACTIVE') return;
          const claimedNim = packet.claims.reduce((acc, c) => acc + c.amountNim, 0);
          const remainingNim = Number((packet.totalNim - claimedNim).toFixed(5));

          if (remainingNim > 0 && !escrowSigner.isPaused()) {
            const refundTx = await escrowSigner.sendNim(
              packet.creatorAddress,
              remainingNim,
              `rp_expiry_refund_${packet.id}`
            );
            packet.refundTxHash = refundTx.txHash;
            packet.status = 'REFUNDED';

            db.state.ledger.unshift({
              id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
              type: 'REDPACKET_REFUND',
              refType: 'REDPACKET',
              refId: packet.id,
              amountNim: remainingNim,
              fromAddress: refundTx.fromAddress,
              toAddress: refundTx.toAddress,
              txHash: refundTx.txHash,
              blockHeight: refundTx.blockHeight,
              createdAt: refundTx.timestamp,
            });
            db.adjustUserBalance(packet.creatorId, remainingNim);
          } else {
            packet.status = 'EXPIRED';
          }
          emitEvent('REDPACKET_UPDATED', packet);
        });
      }
    }
  }

  // 3. Check Payment Requests
  for (const req of db.state.requests) {
    if (req.status === 'OPEN' && now >= new Date(req.expiresAt).getTime()) {
      req.status = 'EXPIRED';
      db.save();
    }
  }
}
