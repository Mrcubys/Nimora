import crypto from 'crypto';
import {
  type CashbackTxType,
  type CashbackClaimItem,
  type CashbackConfig,
  calculateRandomCashback,
  ADMIN_WALLET_ADDRESS,
} from '../../packages/shared/index.ts';
import { db, type CashbackRecord } from './db.ts';
import { escrowSigner } from './escrowSigner.ts';

export interface EvaluateFraudResult {
  score: number; // 0 to 100
  reasons: string[];
}

/**
 * Calculates a fraud risk assessment score (0 to 100) and human-readable indicator flags
 * to assist the admin during manual review.
 */
export function evaluateCashbackFraudRisk(
  userId: string,
  userAddress: string,
  txType: CashbackTxType,
  txAmountNim: number
): EvaluateFraudResult {
  const user = db.state.users.find((u) => u.id === userId || u.address === userAddress);
  const reasons: string[] = [];
  let score = 15; // baseline low risk

  if (!user) {
    return {
      score: 85,
      reasons: ['User account record not found in system directory'],
    };
  }

  // Account age check
  const accountAgeDays = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 3600 * 24);
  if (accountAgeDays < 1) {
    score += 25;
    reasons.push('New account registered within the last 24 hours');
  } else if (accountAgeDays > 14) {
    score = Math.max(5, score - 10);
    reasons.push(`Account active for ${Math.floor(accountAgeDays)} days`);
  }

  // Trade history check
  if (user.completedTrades >= 10) {
    score = Math.max(5, score - 15);
    reasons.push(`Established trader with ${user.completedTrades} completed P2P trades`);
  } else if (user.completedTrades === 0 && txType === 'P2P_SELL_ORDER') {
    score += 15;
    reasons.push('First P2P sell trade on record');
  }

  // Dispute check
  const userDisputes = db.state.disputes.filter(
    (d) => d.openedById === user.id || d.status === 'OPEN'
  );
  if (userDisputes.length > 0) {
    score += 35;
    reasons.push(`Involved in ${userDisputes.length} active or historical dispute(s)`);
  } else {
    reasons.push('Zero dispute history (clean track record)');
  }

  // Frequency check: multiple claims today
  const oneDayAgo = Date.now() - 24 * 3600 * 1000;
  const claimsToday = db.state.cashbackClaims.filter(
    (c) => c.userId === user.id && new Date(c.createdAt).getTime() > oneDayAgo
  );
  if (claimsToday.length >= 3) {
    score += 25;
    reasons.push(`High velocity: ${claimsToday.length} cashback claims submitted today`);
  }

  // Transaction amount sanity check
  if (txAmountNim >= 100000) {
    reasons.push(`High value transaction (${txAmountNim.toLocaleString()} NIM)`);
  }

  // Bound score between 5 and 99
  const boundedScore = Math.max(5, Math.min(99, score));
  return { score: boundedScore, reasons };
}

/**
 * Automatically creates a PENDING cashback claim if the feature is activated by the admin
 * and transaction meets the minimum amount requirement (>= 5,000 NIM).
 */
export async function generateCashbackClaimIfEligible(params: {
  userId: string;
  txType: CashbackTxType;
  txReferenceId: string;
  txAmountNim: number;
}): Promise<CashbackRecord | null> {
  const config = db.state.cashbackConfig;
  if (!config || !config.isActive) {
    return null;
  }

  const minReq = config.minTxAmountNim || 5000;
  if (params.txAmountNim < minReq) {
    return null;
  }

  const user = db.state.users.find((u) => u.id === params.userId);
  if (!user) {
    return null;
  }

  // Check if a claim for this exact transaction already exists
  const existing = db.state.cashbackClaims.find(
    (c) => c.txType === params.txType && c.txReferenceId === params.txReferenceId
  );
  if (existing) {
    return existing;
  }

  const cashbackAmountNim = calculateRandomCashback(
    config.minCashbackNim || 200,
    config.maxCashbackNim || 5000
  );

  const fraudEval = evaluateCashbackFraudRisk(
    user.id,
    user.address,
    params.txType,
    params.txAmountNim
  );

  const claim: CashbackClaimItem = {
    id: `cb_${crypto.randomBytes(6).toString('hex')}`,
    userId: user.id,
    userAddress: user.address,
    userName: user.realName || user.address,
    txType: params.txType,
    txReferenceId: params.txReferenceId,
    txAmountNim: params.txAmountNim,
    cashbackAmountNim,
    status: 'PENDING',
    fraudRiskScore: fraudEval.score,
    fraudReasons: fraudEval.reasons,
    adminNotes: null,
    txHash: null,
    confirmedAt: null,
    rejectedAt: null,
    createdAt: new Date().toISOString(),
  };

  db.state.cashbackClaims.unshift(claim);
  db.save();

  db.logAudit(
    user.id,
    user.realName || user.address,
    'CASHBACK_CLAIM_GENERATED',
    'CashbackClaim',
    claim.id,
    {
      txType: claim.txType,
      txAmountNim: claim.txAmountNim,
      cashbackAmountNim: claim.cashbackAmountNim,
      fraudRiskScore: claim.fraudRiskScore,
    }
  );

  return claim;
}

/**
 * Admin confirms the claim:
 * 1. Verifies escrow wallet has sufficient balance
 * 2. Automatically pays out the cashback to the user's Nimiq wallet
 * 3. Deducts from the escrow wallet balance
 */
export async function confirmCashbackClaim(
  claimId: string,
  adminId: string,
  adminNotes?: string
): Promise<{ success: boolean; claim: CashbackRecord; txHash: string }> {
  return await db.withLock(`cashback:${claimId}`, async () => {
    const claim = db.state.cashbackClaims.find((c) => c.id === claimId);
    if (!claim) {
      throw new Error('Cashback claim not found');
    }
    if (claim.status !== 'PENDING') {
      throw new Error(`Cannot confirm claim in status ${claim.status}`);
    }

    const config = db.state.cashbackConfig;
    if (config.escrowBalanceNim < claim.cashbackAmountNim) {
      throw new Error(
        `Insufficient escrow wallet balance (${config.escrowBalanceNim.toLocaleString()} NIM). Please deposit at least ${(
          claim.cashbackAmountNim - config.escrowBalanceNim
        ).toLocaleString()} NIM into the escrow wallet first.`
      );
    }

    // Platform signs and releases funds directly from the escrow wallet to the user's address
    const payoutTx = await escrowSigner.sendNim(
      claim.userAddress,
      claim.cashbackAmountNim,
      `cashback_payout_${claim.id}`
    );

    // Deduct escrow pool and update stats
    config.escrowBalanceNim = Math.max(
      0,
      Number((config.escrowBalanceNim - claim.cashbackAmountNim).toFixed(5))
    );
    config.totalPaidOutNim = Number(
      ((config.totalPaidOutNim || 0) + claim.cashbackAmountNim).toFixed(5)
    );
    config.updatedAt = new Date().toISOString();

    claim.status = 'CONFIRMED';
    claim.txHash = payoutTx.txHash;
    claim.confirmedAt = new Date().toISOString();
    claim.adminNotes = adminNotes || 'Approved by admin — verified clean transaction activity.';

    // Record ledger entry
    db.state.ledger.unshift({
      id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
      type: 'ESCROW_RELEASE',
      refType: 'ORDER',
      refId: claim.id,
      amountNim: claim.cashbackAmountNim,
      fromAddress: payoutTx.fromAddress,
      toAddress: payoutTx.toAddress,
      txHash: payoutTx.txHash,
      blockHeight: payoutTx.blockHeight,
      createdAt: payoutTx.timestamp,
    });

    db.logAudit(
      adminId,
      'Admin',
      'CASHBACK_CLAIM_CONFIRMED',
      'CashbackClaim',
      claim.id,
      {
        recipient: claim.userAddress,
        cashbackAmountNim: claim.cashbackAmountNim,
        txHash: payoutTx.txHash,
      }
    );

    db.save();
    return { success: true, claim, txHash: payoutTx.txHash };
  });
}

/**
 * Admin rejects the claim with a reason.
 */
export async function rejectCashbackClaim(
  claimId: string,
  adminId: string,
  reason: string
): Promise<CashbackRecord> {
  return await db.withLock(`cashback:${claimId}`, async () => {
    const claim = db.state.cashbackClaims.find((c) => c.id === claimId);
    if (!claim) {
      throw new Error('Cashback claim not found');
    }
    if (claim.status !== 'PENDING') {
      throw new Error(`Cannot reject claim in status ${claim.status}`);
    }

    claim.status = 'REJECTED';
    claim.adminNotes = reason;
    claim.rejectedAt = new Date().toISOString();

    db.logAudit(
      adminId,
      'Admin',
      'CASHBACK_CLAIM_REJECTED',
      'CashbackClaim',
      claim.id,
      { reason }
    );

    db.save();
    return claim;
  });
}

/**
 * Admin deposits funds into the cashback escrow wallet pool.
 */
export async function depositCashbackEscrow(
  amountNim: number,
  adminId: string,
  txHash?: string,
  note?: string
): Promise<{ config: CashbackConfig; txHash: string }> {
  const config = db.state.cashbackConfig;
  const hash =
    txHash ||
    crypto
      .createHash('sha256')
      .update(`escrow_deposit_${Date.now()}_${amountNim}`)
      .digest('hex');

  config.escrowBalanceNim = Number(((config.escrowBalanceNim || 0) + amountNim).toFixed(5));
  config.updatedAt = new Date().toISOString();

  db.state.ledger.unshift({
    id: `ldg_${crypto.randomBytes(6).toString('hex')}`,
    type: 'ESCROW_DEPOSIT',
    refType: 'ORDER',
    refId: `escrow_dep_${Date.now()}`,
    amountNim,
    fromAddress: ADMIN_WALLET_ADDRESS,
    toAddress: config.escrowWalletAddress || ADMIN_WALLET_ADDRESS,
    txHash: hash,
    blockHeight: escrowSigner.getNextBlockHeight(),
    createdAt: new Date().toISOString(),
  });

  db.logAudit(
    adminId,
    'Admin',
    'CASHBACK_ESCROW_DEPOSITED',
    'CashbackEscrow',
    config.escrowWalletAddress,
    { amountNim, txHash: hash, note }
  );

  db.save();
  return { config, txHash: hash };
}
