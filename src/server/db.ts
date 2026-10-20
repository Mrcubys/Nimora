import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  type P2POrderStatus,
  type CancelReason,
  SUPPORTED_REGIONS,
  maskAccountNumber,
  ADMIN_WALLET_ADDRESS,
  normalizeNimiqAddress,
  type CashbackConfig,
  type CashbackClaimItem,
} from '../../packages/shared/index.ts';
import { escrowSigner } from './escrowSigner.ts';

export type CashbackRecord = CashbackClaimItem;

export interface UserRecord {
  id: string;
  address: string;
  realName: string | null;
  country: string | null;
  onboardedAt: string | null;
  createdAt: string;
  locale: string;
  notificationPrefs: {
    orderUpdates: boolean;
    chatMessages: boolean;
    reminders: boolean;
  };
  isAdmin: boolean;
  isBanned: boolean;
  noShowCount: number;
  completedTrades: number;
  lastActiveAt: string;
  twitterHandle?: string | null;
  telegramHandle?: string | null;
  telegramUserId?: string | null;
  balanceNim?: number;
}

export interface PaymentMethodRecord {
  id: string;
  userId: string;
  country: string;
  providerCode: string;
  providerName: string;
  type: 'BANK' | 'EWALLET';
  accountName: string;
  accountNumberEncrypted: string;
  accountNumberMasked: string;
  extraFields: Record<string, string>;
  isActive: boolean;
  createdAt: string;
}

export interface P2PAdRecord {
  id: string;
  userId: string;
  userRealName: string;
  userCompletedTrades: number;
  userCompletionRate: number;
  side: 'SELL_NIM' | 'BUY_NIM';
  country: string;
  fiatCurrency: string;
  priceMode: 'FIXED' | 'MARKET_MARGIN';
  price: number;
  minAmountNim: number;
  maxAmountNim: number;
  availableNim: number;
  paymentMethodIds: string[];
  paymentMethodProviders: Array<{ code: string; name: string; type: 'BANK' | 'EWALLET' }>;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED';
  createdAt: string;
}

export interface PaymentMethodSnapshot {
  id: string;
  providerCode: string;
  providerName: string;
  type: 'BANK' | 'EWALLET';
  accountName: string;
  accountNumberFull: string;
  accountNumberMasked: string;
  extraFields?: Record<string, string>;
}

export interface P2POrderRecord {
  id: string;
  adId: string;
  sellerId: string;
  sellerName: string;
  sellerAddress: string;
  buyerId: string;
  buyerName: string;
  buyerAddress: string;
  country: string;
  amountNim: number;
  fiatAmount: number;
  fiatCurrency: string;
  priceSnapshot: number;
  paymentMethodSnapshot: PaymentMethodSnapshot;
  status: P2POrderStatus;
  cancelReason: CancelReason | null;
  escrowAddress: string;
  depositTxHash: string | null;
  releaseTxHash: string | null;
  refundTxHash: string | null;
  depositDeadline: string;
  paymentDeadline: string | null;
  confirmDeadline: string | null;
  paymentProofUrl: string | null;
  reminderCount: number;
  lastReminderAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderMessageRecord {
  id: string;
  orderId: string;
  senderId: string | null;
  senderName: string;
  type: 'TEXT' | 'IMAGE' | 'SYSTEM' | 'PAYMENT_REMINDER';
  body: string;
  attachmentUrl?: string;
  attachmentMime?: string;
  replyToId?: string;
  readAt: string | null;
  reported: boolean;
  createdAt: string;
}

export interface DisputeRecord {
  id: string;
  orderId: string;
  openedById: string;
  openedByName: string;
  reason: string;
  evidence: {
    notes: string;
    reportedMessageIds: string[];
    paymentProofUrl: string | null;
  };
  status: 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED_RELEASE' | 'RESOLVED_REFUND';
  adminId: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface PaymentRequestRecord {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAddress: string;
  amountNim: number | null;
  note: string;
  status: 'OPEN' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  paidByAddress: string | null;
  paidTxHash: string | null;
  expiresAt: string;
  slug: string;
  createdAt: string;
}

export interface RedPacketClaimRecord {
  id: string;
  packetId: string;
  claimerAddress: string;
  userId: string;
  claimerName: string;
  amountNim: number;
  payoutTxHash: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  createdAt: string;
}

export interface RedPacketRecord {
  id: string;
  creatorId: string;
  creatorName: string;
  creatorAddress: string;
  totalNim: number;
  slots: number;
  mode: 'EQUAL' | 'RANDOM';
  message: string;
  status: 'PENDING_DEPOSIT' | 'ACTIVE' | 'FINISHED' | 'EXPIRED' | 'REFUNDED';
  depositTxHash: string | null;
  refundTxHash: string | null;
  expiresAt: string;
  slug: string;
  preallocatedAmounts: number[]; // integer luna shares
  claims: RedPacketClaimRecord[];
  createdAt: string;
}

export interface LedgerEntryRecord {
  id: string;
  type:
    | 'ESCROW_DEPOSIT'
    | 'ESCROW_RELEASE'
    | 'ESCROW_REFUND'
    | 'REDPACKET_DEPOSIT'
    | 'REDPACKET_PAYOUT'
    | 'REDPACKET_REFUND'
    | 'REQUEST_PAYMENT';
  refType: 'ORDER' | 'REDPACKET' | 'REQUEST';
  refId: string;
  amountNim: number;
  fromAddress: string;
  toAddress: string;
  txHash: string;
  blockHeight: number;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  meta: Record<string, unknown>;
  ip: string;
  createdAt: string;
}

export interface BannerRecord {
  id: string;
  title: string;
  subtitle: string;
  imageDataUrl: string; // Strictly uploaded file data URL (data:image/...)
  targetRoute: string;  // Destination route/url configured by admin on upload
  isActive: boolean;
  createdAt: string;
}

export interface SocialAccountRecord {
  id: string;
  userId: string;
  platform: 'TWITTER' | 'TELEGRAM';
  handle: string; // normalized lowercase without @
  displayHandle: string; // @handle
  verificationCode: string;
  isVerified: boolean;
  verifiedAt: string | null;
  createdAt: string;
  telegramUserId?: string | null;
  chatId?: string | null;
}

export interface SocialTransferRecord {
  id: string;
  platform: 'TWITTER' | 'TELEGRAM';
  senderUserId: string | null;
  senderHandle: string;
  recipientUserId: string | null;
  recipientHandle: string;
  amountNim: number;
  status:
    | 'SUCCESS'
    | 'PENDING_RECIPIENT_CLAIM'
    | 'FAILED_RECIPIENT_NOT_REGISTERED'
    | 'FAILED_INSUFFICIENT_FUNDS'
    | 'FAILED_SENDER_NOT_REGISTERED'
    | 'FAILED_INVALID_FORMAT';
  rawText: string;
  postUrlOrId?: string;
  botResponse: string;
  txHash?: string | null;
  createdAt: string;
}

export interface SocialBotConfig {
  twitterCookies: string;
  xCookies?: string;
  telegramBotToken: string;
  isListening: boolean;
  autoReply: boolean;
  lastTelegramUpdateId?: number;
  processedTelegramMessageIds?: string[];
}

export interface DatabaseState {
  schemaVersion?: number;
  users: UserRecord[];
  paymentMethods: PaymentMethodRecord[];
  ads: P2PAdRecord[];
  orders: P2POrderRecord[];
  messages: OrderMessageRecord[];
  disputes: DisputeRecord[];
  requests: PaymentRequestRecord[];
  redPackets: RedPacketRecord[];
  ledger: LedgerEntryRecord[];
  auditLogs: AuditLogRecord[];
  banners: BannerRecord[];
  socialAccounts: SocialAccountRecord[];
  socialTransfers: SocialTransferRecord[];
  socialBotConfig: SocialBotConfig;
  cashbackConfig: CashbackConfig;
  cashbackClaims: CashbackRecord[];
}

function ibanMod97(str: string): number {
  let remainder = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const val = code >= 65 ? code - 55 : code - 48;
    if (val >= 10) {
      remainder = (remainder * 100 + val) % 97;
    } else {
      remainder = (remainder * 10 + val) % 97;
    }
  }
  return remainder;
}

function makeValidAddress(seed32: string): string {
  const cleanBody = seed32
    .replace(/[^0-9A-HJ-NP-VY-Z]/gi, '0')
    .toUpperCase()
    .padEnd(32, '0')
    .slice(0, 32);
  const rem = ibanMod97(cleanBody + 'NQ00');
  const check = String(98 - rem).padStart(2, '0');
  const full = `NQ${check}${cleanBody}`;
  return full.match(/.{1,4}/g)!.join(' ');
}

const DATA_FILE = path.resolve(process.cwd(), '.nimora-db.json');
const ENCRYPTION_SECRET = crypto
  .createHash('sha256')
  .update(process.env.NIMIQ_ESCROW_PRIVATE_KEY || 'nimora-secret-key-2026')
  .digest();

export function encryptAccountField(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_SECRET, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptAccountField(payload: string): string {
  try {
    const [ivHex, tagHex, encHex] = payload.split(':');
    if (!ivHex || !tagHex || !encHex) return payload;
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      ENCRYPTION_SECRET,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '••••••••';
  }
}

function createInitialSeedState(): DatabaseState {
  const now = new Date();
  const earlier = new Date(now.getTime() - 3600 * 1000 * 4).toISOString();

  const addrId1 = makeValidAddress('RAKASANT0S01ND0NES1AMKT188992026');
  const addrId2 = makeValidAddress('NAD1APUTR199JKT00011223344552026');
  const addrSg1 = makeValidAddress('WE1L1NCTANS1NGAP0REMKT0011222026');
  const addrIn1 = makeValidAddress('AARAVSHARMAMUMBA11ND1AMKT9982026');
  const addrGb1 = makeValidAddress('0L1VERSTERL1NGL0ND0NUKMKT7762026');
  const addrUs1 = makeValidAddress('MAR0NVALENCEUSA01928374655002026');
  const addrMy1 = makeValidAddress('A1SYAHRZKLMY00918273645511222026');
  const addrDe1 = makeValidAddress('LUKASWE1ERDEBERL1N99887766552026');

  // Seed realistic peer merchants across supported countries with valid MOD-97 Nimiq addresses
  const users: UserRecord[] = [
    {
      id: 'usr_merchant_id_1',
      address: addrId1,
      realName: 'Raka Santoso',
      country: 'ID',
      onboardedAt: earlier,
      createdAt: earlier,
      locale: 'id',
      notificationPrefs: { orderUpdates: true, chatMessages: true, reminders: true },
      isAdmin: false,
      isBanned: false,
      noShowCount: 0,
      completedTrades: 148,
      lastActiveAt: now.toISOString(),
    },
    {
      id: 'usr_merchant_id_2',
      address: addrId2,
      realName: 'Nadia Putri',
      country: 'ID',
      onboardedAt: earlier,
      createdAt: earlier,
      locale: 'id',
      notificationPrefs: { orderUpdates: true, chatMessages: true, reminders: true },
      isAdmin: false,
      isBanned: false,
      noShowCount: 0,
      completedTrades: 92,
      lastActiveAt: now.toISOString(),
    },
    {
      id: 'usr_merchant_sg_1',
      address: addrSg1,
      realName: 'Wei Ling Tan',
      country: 'SG',
      onboardedAt: earlier,
      createdAt: earlier,
      locale: 'en',
      notificationPrefs: { orderUpdates: true, chatMessages: true, reminders: true },
      isAdmin: false,
      isBanned: false,
      noShowCount: 0,
      completedTrades: 176,
      lastActiveAt: now.toISOString(),
    },
    {
      id: 'usr_merchant_in_1',
      address: addrIn1,
      realName: 'Aarav Sharma',
      country: 'IN',
      onboardedAt: earlier,
      createdAt: earlier,
      locale: 'hi',
      notificationPrefs: { orderUpdates: true, chatMessages: true, reminders: true },
      isAdmin: false,
      isBanned: false,
      noShowCount: 0,
      completedTrades: 134,
      lastActiveAt: now.toISOString(),
    },
    {
      id: 'usr_merchant_gb_1',
      address: addrGb1,
      realName: 'Oliver Sterling',
      country: 'GB',
      onboardedAt: earlier,
      createdAt: earlier,
      locale: 'en',
      notificationPrefs: { orderUpdates: true, chatMessages: true, reminders: true },
      isAdmin: false,
      isBanned: false,
      noShowCount: 0,
      completedTrades: 204,
      lastActiveAt: now.toISOString(),
    },
    {
      id: 'usr_merchant_us_1',
      address: addrUs1,
      realName: 'Marcus Vance',
      country: 'US',
      onboardedAt: earlier,
      createdAt: earlier,
      locale: 'en',
      notificationPrefs: { orderUpdates: true, chatMessages: true, reminders: true },
      isAdmin: false,
      isBanned: false,
      noShowCount: 0,
      completedTrades: 215,
      lastActiveAt: now.toISOString(),
    },
    {
      id: 'usr_merchant_my_1',
      address: addrMy1,
      realName: 'Aisyah Razak',
      country: 'MY',
      onboardedAt: earlier,
      createdAt: earlier,
      locale: 'ms',
      notificationPrefs: { orderUpdates: true, chatMessages: true, reminders: true },
      isAdmin: false,
      isBanned: false,
      noShowCount: 0,
      completedTrades: 64,
      lastActiveAt: now.toISOString(),
    },
    {
      id: 'usr_merchant_de_1',
      address: addrDe1,
      realName: 'Lukas Weber',
      country: 'DE',
      onboardedAt: earlier,
      createdAt: earlier,
      locale: 'de',
      notificationPrefs: { orderUpdates: true, chatMessages: true, reminders: true },
      isAdmin: false,
      isBanned: false,
      noShowCount: 0,
      completedTrades: 119,
      lastActiveAt: now.toISOString(),
    },
  ];

  const paymentMethods: PaymentMethodRecord[] = [
    {
      id: 'pm_id_bca_1',
      userId: 'usr_merchant_id_1',
      country: 'ID',
      providerCode: 'BCA',
      providerName: 'Bank Central Asia (BCA)',
      type: 'BANK',
      accountName: 'Raka Santoso',
      accountNumberEncrypted: encryptAccountField('8420918273'),
      accountNumberMasked: maskAccountNumber('8420918273'),
      extraFields: {},
      isActive: true,
      createdAt: earlier,
    },
    {
      id: 'pm_id_gopay_1',
      userId: 'usr_merchant_id_1',
      country: 'ID',
      providerCode: 'GOPAY',
      providerName: 'GoPay',
      type: 'EWALLET',
      accountName: 'Raka Santoso',
      accountNumberEncrypted: encryptAccountField('081288990011'),
      accountNumberMasked: maskAccountNumber('081288990011'),
      extraFields: {},
      isActive: true,
      createdAt: earlier,
    },
    {
      id: 'pm_id_mandiri_2',
      userId: 'usr_merchant_id_2',
      country: 'ID',
      providerCode: 'MANDIRI',
      providerName: 'Bank Mandiri',
      type: 'BANK',
      accountName: 'Nadia Putri',
      accountNumberEncrypted: encryptAccountField('1240098765431'),
      accountNumberMasked: maskAccountNumber('1240098765431'),
      extraFields: {},
      isActive: true,
      createdAt: earlier,
    },
    {
      id: 'pm_id_dana_2',
      userId: 'usr_merchant_id_2',
      country: 'ID',
      providerCode: 'DANA',
      providerName: 'DANA',
      type: 'EWALLET',
      accountName: 'Nadia Putri',
      accountNumberEncrypted: encryptAccountField('081377665544'),
      accountNumberMasked: maskAccountNumber('081377665544'),
      extraFields: {},
      isActive: true,
      createdAt: earlier,
    },
    {
      id: 'pm_sg_paynow_1',
      userId: 'usr_merchant_sg_1',
      country: 'SG',
      providerCode: 'PAYNOW',
      providerName: 'PayNow (Mobile / NRIC)',
      type: 'EWALLET',
      accountName: 'Wei Ling Tan',
      accountNumberEncrypted: encryptAccountField('+6581239876'),
      accountNumberMasked: maskAccountNumber('+6581239876'),
      extraFields: {},
      isActive: true,
      createdAt: earlier,
    },
    {
      id: 'pm_in_upi_1',
      userId: 'usr_merchant_in_1',
      country: 'IN',
      providerCode: 'UPI',
      providerName: 'UPI (Unified Payments Interface)',
      type: 'EWALLET',
      accountName: 'Aarav Sharma',
      accountNumberEncrypted: encryptAccountField('aarav.sharma@okaxis'),
      accountNumberMasked: maskAccountNumber('aarav.sharma@okaxis'),
      extraFields: {},
      isActive: true,
      createdAt: earlier,
    },
    {
      id: 'pm_gb_fp_1',
      userId: 'usr_merchant_gb_1',
      country: 'GB',
      providerCode: 'FASTER_PAYMENTS',
      providerName: 'UK Faster Payments',
      type: 'BANK',
      accountName: 'Oliver Sterling',
      accountNumberEncrypted: encryptAccountField('04-00-04 82910472'),
      accountNumberMasked: maskAccountNumber('04-00-04 82910472'),
      extraFields: {},
      isActive: true,
      createdAt: earlier,
    },
    {
      id: 'pm_us_zelle_1',
      userId: 'usr_merchant_us_1',
      country: 'US',
      providerCode: 'ZELLE',
      providerName: 'Zelle',
      type: 'EWALLET',
      accountName: 'Marcus Vance',
      accountNumberEncrypted: encryptAccountField('marcus.vance@desk.io'),
      accountNumberMasked: 'ma••••k.io',
      extraFields: {},
      isActive: true,
      createdAt: earlier,
    },
    {
      id: 'pm_my_maybank_1',
      userId: 'usr_merchant_my_1',
      country: 'MY',
      providerCode: 'MAYBANK',
      providerName: 'Maybank',
      type: 'BANK',
      accountName: 'Aisyah Razak',
      accountNumberEncrypted: encryptAccountField('514089123456'),
      accountNumberMasked: maskAccountNumber('514089123456'),
      extraFields: {},
      isActive: true,
      createdAt: earlier,
    },
    {
      id: 'pm_de_sepa_1',
      userId: 'usr_merchant_de_1',
      country: 'DE',
      providerCode: 'SEPA_DE',
      providerName: 'SEPA Bank Transfer (IBAN)',
      type: 'BANK',
      accountName: 'Lukas Weber',
      accountNumberEncrypted: encryptAccountField('DE89370400440532013000'),
      accountNumberMasked: maskAccountNumber('DE89370400440532013000'),
      extraFields: {},
      isActive: true,
      createdAt: earlier,
    },
  ];

  const ads: P2PAdRecord[] = [
    {
      id: 'ad_id_sell_1',
      userId: 'usr_merchant_id_1',
      userRealName: 'Raka Santoso',
      userCompletedTrades: 148,
      userCompletionRate: 99.3,
      side: 'SELL_NIM',
      country: 'ID',
      fiatCurrency: 'IDR',
      priceMode: 'FIXED',
      price: 21.8,
      minAmountNim: 500,
      maxAmountNim: 50000,
      availableNim: 125000,
      paymentMethodIds: ['pm_id_bca_1', 'pm_id_gopay_1'],
      paymentMethodProviders: [
        { code: 'BCA', name: 'Bank Central Asia (BCA)', type: 'BANK' },
        { code: 'GOPAY', name: 'GoPay', type: 'EWALLET' },
      ],
      status: 'ACTIVE',
      createdAt: earlier,
    },
    {
      id: 'ad_id_sell_2',
      userId: 'usr_merchant_id_2',
      userRealName: 'Nadia Putri',
      userCompletedTrades: 92,
      userCompletionRate: 98.5,
      side: 'SELL_NIM',
      country: 'ID',
      fiatCurrency: 'IDR',
      priceMode: 'FIXED',
      price: 21.95,
      minAmountNim: 250,
      maxAmountNim: 30000,
      availableNim: 80000,
      paymentMethodIds: ['pm_id_mandiri_2', 'pm_id_dana_2'],
      paymentMethodProviders: [
        { code: 'MANDIRI', name: 'Bank Mandiri', type: 'BANK' },
        { code: 'DANA', name: 'DANA', type: 'EWALLET' },
      ],
      status: 'ACTIVE',
      createdAt: earlier,
    },
    {
      id: 'ad_id_buy_1',
      userId: 'usr_merchant_id_1',
      userRealName: 'Raka Santoso',
      userCompletedTrades: 148,
      userCompletionRate: 99.3,
      side: 'BUY_NIM',
      country: 'ID',
      fiatCurrency: 'IDR',
      priceMode: 'FIXED',
      price: 21.5,
      minAmountNim: 500,
      maxAmountNim: 60000,
      availableNim: 180000,
      paymentMethodIds: ['pm_id_bca_1', 'pm_id_gopay_1'],
      paymentMethodProviders: [
        { code: 'BCA', name: 'Bank Central Asia (BCA)', type: 'BANK' },
        { code: 'GOPAY', name: 'GoPay', type: 'EWALLET' },
      ],
      status: 'ACTIVE',
      createdAt: earlier,
    },
    {
      id: 'ad_sg_sell_1',
      userId: 'usr_merchant_sg_1',
      userRealName: 'Wei Ling Tan',
      userCompletedTrades: 176,
      userCompletionRate: 99.7,
      side: 'SELL_NIM',
      country: 'SG',
      fiatCurrency: 'SGD',
      priceMode: 'FIXED',
      price: 0.00185,
      minAmountNim: 500,
      maxAmountNim: 100000,
      availableNim: 200000,
      paymentMethodIds: ['pm_sg_paynow_1'],
      paymentMethodProviders: [
        { code: 'PAYNOW', name: 'PayNow (Mobile / NRIC)', type: 'EWALLET' },
      ],
      status: 'ACTIVE',
      createdAt: earlier,
    },
    {
      id: 'ad_in_sell_1',
      userId: 'usr_merchant_in_1',
      userRealName: 'Aarav Sharma',
      userCompletedTrades: 134,
      userCompletionRate: 99.1,
      side: 'SELL_NIM',
      country: 'IN',
      fiatCurrency: 'INR',
      priceMode: 'FIXED',
      price: 0.118,
      minAmountNim: 500,
      maxAmountNim: 100000,
      availableNim: 180000,
      paymentMethodIds: ['pm_in_upi_1'],
      paymentMethodProviders: [
        { code: 'UPI', name: 'UPI (Unified Payments Interface)', type: 'EWALLET' },
      ],
      status: 'ACTIVE',
      createdAt: earlier,
    },
    {
      id: 'ad_gb_sell_1',
      userId: 'usr_merchant_gb_1',
      userRealName: 'Oliver Sterling',
      userCompletedTrades: 204,
      userCompletionRate: 99.8,
      side: 'SELL_NIM',
      country: 'GB',
      fiatCurrency: 'GBP',
      priceMode: 'FIXED',
      price: 0.00108,
      minAmountNim: 500,
      maxAmountNim: 100000,
      availableNim: 220000,
      paymentMethodIds: ['pm_gb_fp_1'],
      paymentMethodProviders: [
        { code: 'FASTER_PAYMENTS', name: 'UK Faster Payments', type: 'BANK' },
      ],
      status: 'ACTIVE',
      createdAt: earlier,
    },
    {
      id: 'ad_us_sell_1',
      userId: 'usr_merchant_us_1',
      userRealName: 'Marcus Vance',
      userCompletedTrades: 215,
      userCompletionRate: 99.8,
      side: 'SELL_NIM',
      country: 'US',
      fiatCurrency: 'USD',
      priceMode: 'FIXED',
      price: 0.00138,
      minAmountNim: 1000,
      maxAmountNim: 100000,
      availableNim: 250000,
      paymentMethodIds: ['pm_us_zelle_1'],
      paymentMethodProviders: [{ code: 'ZELLE', name: 'Zelle', type: 'EWALLET' }],
      status: 'ACTIVE',
      createdAt: earlier,
    },
    {
      id: 'ad_us_buy_1',
      userId: 'usr_merchant_us_1',
      userRealName: 'Marcus Vance',
      userCompletedTrades: 215,
      userCompletionRate: 99.8,
      side: 'BUY_NIM',
      country: 'US',
      fiatCurrency: 'USD',
      priceMode: 'FIXED',
      price: 0.00135,
      minAmountNim: 1000,
      maxAmountNim: 100000,
      availableNim: 250000,
      paymentMethodIds: ['pm_us_zelle_1'],
      paymentMethodProviders: [{ code: 'ZELLE', name: 'Zelle', type: 'EWALLET' }],
      status: 'ACTIVE',
      createdAt: earlier,
    },
    {
      id: 'ad_my_sell_1',
      userId: 'usr_merchant_my_1',
      userRealName: 'Aisyah Razak',
      userCompletedTrades: 64,
      userCompletionRate: 98.9,
      side: 'SELL_NIM',
      country: 'MY',
      fiatCurrency: 'MYR',
      priceMode: 'FIXED',
      price: 0.0061,
      minAmountNim: 500,
      maxAmountNim: 40000,
      availableNim: 95000,
      paymentMethodIds: ['pm_my_maybank_1'],
      paymentMethodProviders: [{ code: 'MAYBANK', name: 'Maybank', type: 'BANK' }],
      status: 'ACTIVE',
      createdAt: earlier,
    },
    {
      id: 'ad_de_sell_1',
      userId: 'usr_merchant_de_1',
      userRealName: 'Lukas Weber',
      userCompletedTrades: 119,
      userCompletionRate: 99.5,
      side: 'SELL_NIM',
      country: 'DE',
      fiatCurrency: 'EUR',
      priceMode: 'FIXED',
      price: 0.00128,
      minAmountNim: 1000,
      maxAmountNim: 80000,
      availableNim: 190000,
      paymentMethodIds: ['pm_de_sepa_1'],
      paymentMethodProviders: [
        { code: 'SEPA_DE', name: 'SEPA Bank Transfer (IBAN)', type: 'BANK' },
      ],
      status: 'ACTIVE',
      createdAt: earlier,
    },
  ];

  // Do not seed fake public Red Packets ("available Red Packet" section shouldn't encourage users to stay for fake packets)
  const redPackets: RedPacketRecord[] = [];
  const ledger: LedgerEntryRecord[] = [];

  const svgBanner1 = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" width="1200" height="420">
      <defs>
        <linearGradient id="bg1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#1F2348" />
          <stop offset="55%" stop-color="#151836" />
          <stop offset="100%" stop-color="#3a2c0f" />
        </linearGradient>
        <linearGradient id="gold1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#E9B213" />
          <stop offset="100%" stop-color="#EC991C" />
        </linearGradient>
      </defs>
      <rect width="1200" height="420" fill="url(#bg1)" />
      <circle cx="1030" cy="210" r="240" fill="#E9B213" opacity="0.08" />
      <circle cx="960" cy="120" r="110" fill="#EC9B1C" opacity="0.1" />
      <polygon points="980,105 1045,105 1078,162 1045,220 980,220 947,162" fill="url(#gold1)" opacity="0.25" />
      <polygon points="1020,165 1085,165 1118,222 1085,280 1020,280 987,222" fill="url(#gold1)" opacity="0.45" />
    </svg>`
  )}`;

  const svgBanner2 = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 420" width="1200" height="420">
      <defs>
        <linearGradient id="bg2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#3b1229" />
          <stop offset="60%" stop-color="#1F2348" />
          <stop offset="100%" stop-color="#11142B" />
        </linearGradient>
      </defs>
      <rect width="1200" height="420" fill="url(#bg2)" />
      <circle cx="1020" cy="210" r="220" fill="#f43f5e" opacity="0.12" />
      <circle cx="920" cy="280" r="140" fill="#E9B213" opacity="0.1" />
      <rect x="940" y="110" width="140" height="200" rx="22" fill="#e11d48" opacity="0.35" stroke="#E9B213" stroke-width="3" />
      <circle cx="1010" cy="195" r="26" fill="#E9B213" opacity="0.8" />
    </svg>`
  )}`;

  const banners: BannerRecord[] = [
    {
      id: 'bnr_default_p2p',
      title: 'Zero-Fee Local P2P Escrow Trading',
      subtitle: 'Buy & sell NIM in your local currency with 30-minute automatic escrow protection.',
      imageDataUrl: svgBanner1,
      targetRoute: '/p2p',
      isActive: true,
      createdAt: earlier,
    },
    {
      id: 'bnr_default_redpacket',
      title: 'Send & Share Multi-Claim NIM Red Packets',
      subtitle: 'Create Equal or Lucky Random NIM Red Packets funded directly by your Nimiq wallet.',
      imageDataUrl: svgBanner2,
      targetRoute: '/redpacket',
      isActive: true,
      createdAt: earlier,
    },
  ];

  const socialAccounts: SocialAccountRecord[] = [
    {
      id: 'soc_x_bot_official',
      userId: 'usr_merchant_id_1',
      platform: 'TWITTER',
      handle: 'rakasantoso',
      displayHandle: '@rakasantoso',
      verificationCode: 'X-RAKA88',
      isVerified: true,
      verifiedAt: earlier,
      createdAt: earlier,
    },
    {
      id: 'soc_tg_nadia',
      userId: 'usr_merchant_id_2',
      platform: 'TELEGRAM',
      handle: 'nadiaputri',
      displayHandle: '@nadiaputri',
      verificationCode: 'TG-NADIA99',
      isVerified: true,
      verifiedAt: earlier,
      createdAt: earlier,
    },
  ];

  return {
    schemaVersion: 3,
    users,
    paymentMethods,
    ads,
    orders: [],
    messages: [],
    disputes: [],
    requests: [],
    redPackets,
    ledger,
    auditLogs: [],
    banners,
    socialAccounts,
    socialTransfers: [],
    socialBotConfig: {
      twitterCookies: process.env.TWITTER_COOKIES || process.env.X_COOKIES || '',
      telegramBotToken:
        process.env.TELEGRAM_BOT_TOKEN || '8834505856:AAFzOkTpf7MXL3CbqwzR-E-y61n4N20hOuw',
      isListening: true,
      autoReply: true,
    },
    cashbackConfig: {
      isActive: true,
      escrowBalanceNim: 250000,
      escrowWalletAddress: ADMIN_WALLET_ADDRESS,
      minTxAmountNim: 1500,
      minCashbackNim: 200,
      maxCashbackNim: 5000,
      totalPaidOutNim: 3850,
      updatedAt: earlier,
    },
    cashbackClaims: [
      {
        id: 'cb_seed_1',
        userId: 'usr_merchant_budi',
        userAddress: 'NQ22 93F4 B4P9 XA21 8234 KL88 9012 3456',
        userName: 'Budi Santoso',
        txType: 'P2P_SELL_ORDER',
        txReferenceId: 'ad_budi_sell_1',
        txAmountNim: 12000,
        cashbackAmountNim: 1450,
        status: 'CONFIRMED',
        fraudRiskScore: 12,
        fraudReasons: ['Established merchant account', '142 completed trades', 'Verified banking KYC'],
        adminNotes: 'Verified clean trading volume',
        txHash: 'cb_payout_hash_789123456789abcdef',
        confirmedAt: earlier,
        rejectedAt: null,
        createdAt: earlier,
      },
      {
        id: 'cb_seed_2',
        userId: 'usr_merchant_siti',
        userAddress: 'NQ55 12AB CD34 EF56 GH78 IJ90 KL12 MN34',
        userName: 'Siti Rahma',
        txType: 'TIP_TRANSACTION',
        txReferenceId: 'sctx_demo_tip_1',
        txAmountNim: 8000,
        cashbackAmountNim: 2400,
        status: 'CONFIRMED',
        fraudRiskScore: 18,
        fraudReasons: ['Active social tipper', 'Normal tip cadence'],
        adminNotes: 'Approved social reward',
        txHash: 'cb_payout_hash_1234567890abcdef',
        confirmedAt: earlier,
        rejectedAt: null,
        createdAt: earlier,
      },
      {
        id: 'cb_seed_3',
        userId: 'usr_merchant_siti',
        userAddress: 'NQ55 12AB CD34 EF56 GH78 IJ90 KL12 MN34',
        userName: 'Siti Rahma',
        txType: 'RED_PACKET',
        txReferenceId: 'rp_siti_1',
        txAmountNim: 6000,
        cashbackAmountNim: 820,
        status: 'PENDING',
        fraudRiskScore: 24,
        fraudReasons: ['Valid Red Packet deposit locked into escrow', 'Normal distribution pattern'],
        adminNotes: null,
        txHash: null,
        confirmedAt: null,
        rejectedAt: null,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

class NimoraDatabase {
  public state: DatabaseState;
  private locks = new Set<string>();

  constructor() {
    if (fs.existsSync(DATA_FILE)) {
      try {
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(raw) as DatabaseState;
        if (!parsed || (parsed.schemaVersion !== 3 && parsed.schemaVersion !== 4)) {
          this.state = createInitialSeedState();
          this.save();
        } else {
          if (!Array.isArray(parsed.banners)) {
            parsed.banners = createInitialSeedState().banners;
          }
          if (!Array.isArray(parsed.socialAccounts)) {
            parsed.socialAccounts = createInitialSeedState().socialAccounts;
          }
          if (!Array.isArray(parsed.socialTransfers)) {
            parsed.socialTransfers = [];
          }
          if (!parsed.socialBotConfig) {
            parsed.socialBotConfig = {
              twitterCookies: process.env.TWITTER_COOKIES || process.env.X_COOKIES || '',
              telegramBotToken:
                process.env.TELEGRAM_BOT_TOKEN || '8834505856:AAFzOkTpf7MXL3CbqwzR-E-y61n4N20hOuw',
              isListening: true,
              autoReply: true,
            };
          } else {
            if (!parsed.socialBotConfig.telegramBotToken) {
              parsed.socialBotConfig.telegramBotToken =
                process.env.TELEGRAM_BOT_TOKEN || '8834505856:AAFzOkTpf7MXL3CbqwzR-E-y61n4N20hOuw';
            }
            if (typeof parsed.socialBotConfig.twitterCookies !== 'string') {
              parsed.socialBotConfig.twitterCookies = parsed.socialBotConfig.xCookies || '';
            }
            if (typeof parsed.socialBotConfig.isListening !== 'boolean') {
              parsed.socialBotConfig.isListening = true;
            }
          }
          if (!parsed.cashbackConfig) {
            parsed.cashbackConfig = createInitialSeedState().cashbackConfig;
          }
          if (!Array.isArray(parsed.cashbackClaims)) {
            parsed.cashbackClaims = createInitialSeedState().cashbackClaims;
          }
          parsed.schemaVersion = 4;
          // Ensure every user has a valid balanceNim
          for (const u of parsed.users || []) {
            if (typeof u.balanceNim !== 'number') {
              const isAdmin = u.isAdmin || normalizeNimiqAddress(u.address) === ADMIN_WALLET_ADDRESS;
              u.balanceNim = isAdmin ? 250_000 : (u.id.startsWith('usr_merchant_') ? 50_000 : 12_500);
            }
          }
          this.state = parsed;
          this.save();
        }
      } catch {
        this.state = createInitialSeedState();
        this.save();
      }
    } else {
      this.state = createInitialSeedState();
      this.save();
    }
  }

  public getUserBalance(userIdOrAddress: string): number {
    const raw = userIdOrAddress.trim();
    const cleanAddr = normalizeNimiqAddress(raw);
    const user = this.state.users.find(
      (u) =>
        u.id === raw ||
        normalizeNimiqAddress(u.address) === cleanAddr ||
        u.address.replace(/\s+/g, '').toUpperCase() === raw.replace(/\s+/g, '').toUpperCase()
    );
    if (!user) {
      return cleanAddr === ADMIN_WALLET_ADDRESS ? 250_000 : 12_500;
    }
    if (typeof user.balanceNim !== 'number') {
      const isAdmin = user.isAdmin || normalizeNimiqAddress(user.address) === ADMIN_WALLET_ADDRESS;
      user.balanceNim = isAdmin ? 250_000 : (user.id.startsWith('usr_merchant_') ? 50_000 : 12_500);
      this.save();
    }
    return user.balanceNim;
  }

  public adjustUserBalance(userIdOrAddress: string, deltaNim: number): number {
    const raw = userIdOrAddress.trim();
    const cleanAddr = normalizeNimiqAddress(raw);
    let user = this.state.users.find(
      (u) =>
        u.id === raw ||
        normalizeNimiqAddress(u.address) === cleanAddr ||
        u.address.replace(/\s+/g, '').toUpperCase() === raw.replace(/\s+/g, '').toUpperCase()
    );
    if (!user) {
      const initial = cleanAddr === ADMIN_WALLET_ADDRESS ? 250_000 : 12_500;
      user = {
        id: `usr_${crypto.randomBytes(6).toString('hex')}`,
        address: cleanAddr || raw,
        realName: null,
        country: null,
        onboardedAt: null,
        createdAt: new Date().toISOString(),
        locale: 'en',
        notificationPrefs: { orderUpdates: true, chatMessages: true, reminders: true },
        isAdmin: cleanAddr === ADMIN_WALLET_ADDRESS,
        isBanned: false,
        noShowCount: 0,
        completedTrades: 0,
        balanceNim: initial,
        lastActiveAt: new Date().toISOString(),
      };
      this.state.users.unshift(user);
    }
    if (typeof user.balanceNim !== 'number') {
      const isAdmin = user.isAdmin || normalizeNimiqAddress(user.address) === ADMIN_WALLET_ADDRESS;
      user.balanceNim = isAdmin ? 250_000 : (user.id.startsWith('usr_merchant_') ? 50_000 : 12_500);
    }
    user.balanceNim = Math.max(0, Number((user.balanceNim + deltaNim).toFixed(5)));
    this.save();
    return user.balanceNim;
  }

  public save(): void {
    try {
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to persist .nimora-db.json:', err);
    }
  }

  public async withLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
    while (this.locks.has(lockKey)) {
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    this.locks.add(lockKey);
    try {
      const result = await fn();
      this.save();
      return result;
    } finally {
      this.locks.delete(lockKey);
    }
  }

  public logAudit(
    actorId: string,
    actorName: string,
    action: string,
    entity: string,
    entityId: string,
    meta: Record<string, unknown>,
    ip = '127.0.0.1'
  ): AuditLogRecord {
    const entry: AuditLogRecord = {
      id: `aud_${crypto.randomBytes(6).toString('hex')}`,
      actorId,
      actorName,
      action,
      entity,
      entityId,
      meta,
      ip,
      createdAt: new Date().toISOString(),
    };
    this.state.auditLogs.unshift(entry);
    if (this.state.auditLogs.length > 500) {
      this.state.auditLogs.length = 500;
    }
    this.save();
    return entry;
  }
}

export const db = new NimoraDatabase();
