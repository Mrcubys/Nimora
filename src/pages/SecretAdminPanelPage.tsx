import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldAlert,
  Shield,
  Lock,
  Users,
  Activity,
  Scale,
  Ban,
  CheckCircle2,
  RefreshCw,
  ArrowUpRight,
  Clock,
  FileCheck2,
  Eye,
  X,
  ImagePlus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Upload,
  Wallet,
  Gift,
  Sparkles,
  AtSign,
  Send,
  Bot,
  Key,
  Coins,
  BadgePercent,
  AlertTriangle,
  Check,
  CheckCheck,
  FlaskConical,
} from 'lucide-react';
import {
  getWalletAccount,
  signChallengeMessage,
  sendNim,
  isInsideNimiqPay,
  setMockWalletAddress,
  VALID_SANDBOX_WALLETS,
} from '../lib/nimiq/sdk.ts';
import { formatNim, formatFiat, shortenAddress } from '../lib/nimiq/units.ts';
import {
  SUPPORTED_REGIONS,
  P2POrderStatus,
  ADMIN_WALLET_ADDRESS,
  normalizeNimiqAddress,
  type SocialAccountItem,
  type SocialTransferItem,
  type CashbackConfig,
  type CashbackClaimItem,
  type CashbackTxType,
  type CashbackClaimStatus,
} from '../../packages/shared/index.ts';
import { encodeRedPacketQR } from '../lib/qr/payload.ts';
import { QRCard, SendConfirmationSheet } from '../components/ui/CoreComponents.tsx';

const ADMIN_TOKEN_STORAGE_KEY = 'nimora_secret_admin_token_2026';

interface AdminStats {
  totalUsers: number;
  bannedUsers: number;
  onboardedUsers: number;
  totalAds: number;
  activeAds: number;
  totalOrders: number;
  activeOrders: number;
  disputedOrders: number;
  completedOrders: number;
  totalVolumeNim: number;
  totalPaymentRequests: number;
  totalRedPackets: number;
  totalBanners: number;
  escrowAddress: string;
  adminWalletAddress: string;
}

interface AdminUserRow {
  id: string;
  address: string;
  realName: string | null;
  country: string | null;
  currency: string | null;
  locale: string;
  role: 'USER' | 'ADMIN';
  isBanned: boolean;
  onboardingCompleted: boolean;
  completedTrades: number;
  cancelledTrades: number;
  paymentMethodsCount: number;
  activeAdsCount: number;
  ordersCount: number;
  createdAt: string;
}

interface AdminOrderRow {
  id: string;
  adId: string;
  country: string;
  fiatCurrency: string;
  pricePerNim: number;
  amountNim: number;
  fiatAmount: number;
  sellerId: string;
  sellerName: string;
  sellerAddress: string;
  buyerId: string;
  buyerName: string;
  buyerAddress: string;
  selectedPaymentMethod: {
    providerCode: string;
    providerName: string;
    accountName: string;
    accountNumberMasked: string;
  };
  status: P2POrderStatus;
  cancelReason: string | null;
  depositTxHash: string | null;
  releaseTxHash: string | null;
  refundTxHash: string | null;
  proofImageUrl: string | null;
  proofNote: string | null;
  disputeReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AdminAdRow {
  id: string;
  merchantId: string;
  merchantName: string;
  merchantAddress: string;
  side: 'SELL_NIM' | 'BUY_NIM';
  country: string;
  fiatCurrency: string;
  price: number;
  minAmountNim: number;
  maxAmountNim: number;
  availableNim: number;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED';
  createdAt: string;
}

interface AdminBannerRow {
  id: string;
  title: string;
  subtitle: string;
  imageDataUrl: string;
  targetRoute: string;
  isActive: boolean;
  createdAt: string;
}

interface AdminActivityEvent {
  id: string;
  timestamp: string;
  category: 'AUTH' | 'USER' | 'P2P_AD' | 'P2P_ORDER' | 'REQUEST' | 'REDPACKET' | 'ADMIN';
  action: string;
  actorAddress?: string;
  actorName?: string;
  details: string;
  metadata?: Record<string, unknown>;
}

interface AdminRedPacketRow {
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
  expiresAt: string;
  slug: string;
  claims: Array<{
    id: string;
    claimerName: string;
    claimerAddress: string;
    amountNim: number;
    payoutTxHash: string;
    createdAt: string;
  }>;
}

interface AdminOverviewPayload {
  stats: AdminStats;
  users: AdminUserRow[];
  orders: AdminOrderRow[];
  ads: AdminAdRow[];
  banners: AdminBannerRow[];
  redPackets?: AdminRedPacketRow[];
  requests?: unknown[];
  activityLog: AdminActivityEvent[];
  cashbackConfig?: CashbackConfig;
  cashbackClaims?: CashbackClaimItem[];
}

export const SecretAdminPanelPage: React.FC = () => {
  const navigate = useNavigate();
  const [adminToken, setAdminToken] = useState<string | null>(() =>
    sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY)
  );
  const [connectedWallet, setConnectedWallet] = useState<string>('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [adminAuthMode, setAdminAuthMode] = useState<'WALLET' | 'PASSWORD'>('PASSWORD');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [loginStepStatus, setLoginStepStatus] = useState<string | null>(null);

  const [data, setData] = useState<AdminOverviewPayload | null>(null);
  const [redPackets, setRedPackets] = useState<AdminRedPacketRow[]>([]);
  const [activeTab, setActiveTab] = useState<
    'MONITOR' | 'USERS' | 'ORDERS' | 'BANNERS' | 'REDPACKETS' | 'ADS' | 'SOCIAL' | 'CASHBACK'
  >('MONITOR');
  const [userSearch, setUserSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState('ALL');
  const [orderFilter, setOrderFilter] = useState<'ALL' | 'DISPUTED' | 'ACTIVE'>('ALL');
  const [inspectOrder, setInspectOrder] = useState<AdminOrderRow | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // Cashback Feature & Escrow Management State
  const [cashbackConfig, setCashbackConfig] = useState<CashbackConfig>({
    isActive: true,
    escrowBalanceNim: 250000,
    escrowWalletAddress: ADMIN_WALLET_ADDRESS,
    minTxAmountNim: 5000,
    minCashbackNim: 200,
    maxCashbackNim: 5000,
    totalPaidOutNim: 3850,
    updatedAt: new Date().toISOString(),
  });
  const [cashbackClaims, setCashbackClaims] = useState<CashbackClaimItem[]>([]);
  const [cashbackStats, setCashbackStats] = useState<{
    totalEscrowBalanceNim: number;
    totalPaidOutNim: number;
    pendingClaimsCount: number;
    pendingClaimsTotalNim: number;
    confirmedClaimsCount: number;
    rejectedClaimsCount: number;
    totalClaimsCount: number;
  }>({
    totalEscrowBalanceNim: 250000,
    totalPaidOutNim: 3850,
    pendingClaimsCount: 1,
    pendingClaimsTotalNim: 820,
    confirmedClaimsCount: 2,
    rejectedClaimsCount: 0,
    totalClaimsCount: 3,
  });
  const [cashbackStatusFilter, setCashbackStatusFilter] = useState<'ALL' | 'PENDING' | 'CONFIRMED' | 'REJECTED'>('ALL');
  const [cashbackSearch, setCashbackSearch] = useState('');
  const [savingCashbackConfig, setSavingCashbackConfig] = useState(false);
  const [cashbackSuccessMessage, setCashbackSuccessMessage] = useState<string | null>(null);

  // Decoupled Cashback Threshold Inputs (prevents 8s polling interval from reverting values!)
  const [cbMinTxInput, setCbMinTxInput] = useState('5000');
  const [cbMinCashbackInput, setCbMinCashbackInput] = useState('200');
  const [cbMaxCashbackInput, setCbMaxCashbackInput] = useState('5000');
  const [cbFormDirty, setCbFormDirty] = useState(false);

  // Escrow Deposit Form State
  const [escrowDepositModalOpen, setEscrowDepositModalOpen] = useState(false);
  const [depositAmountInput, setDepositAmountInput] = useState('25000');
  const [depositTxHashInput, setDepositTxHashInput] = useState('');
  const [depositNoteInput, setDepositNoteInput] = useState('Admin Cashback Escrow Pool Top-up');
  const [depositingEscrow, setDepositingEscrow] = useState(false);

  // Reject Claim Modal State
  const [rejectingClaimId, setRejectingClaimId] = useState<string | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState('Suspicious circular trading / unverified transaction activity.');
  const [processingClaimId, setProcessingClaimId] = useState<string | null>(null);

  // Social Media Bot & X Account Cookies Configuration State
  const [socialBotConfig, setSocialBotConfig] = useState<{
    twitterCookies: string;
    telegramBotToken: string;
    isListening: boolean;
    autoReply: boolean;
  }>({
    twitterCookies: '',
    telegramBotToken: '8834505856:AAFzOkTpf7MXL3CbqwzR-E-y61n4N20hOuw',
    isListening: true,
    autoReply: true,
  });

  // Decoupled Social Bot Inputs (prevents 8s polling interval from reverting typed token/cookies)
  const [twitterCookiesInput, setTwitterCookiesInput] = useState('');
  const [telegramBotTokenInput, setTelegramBotTokenInput] = useState('8834505856:AAFzOkTpf7MXL3CbqwzR-E-y61n4N20hOuw');
  const [socialFormDirty, setSocialFormDirty] = useState(false);
  const [socialAccounts, setSocialAccounts] = useState<SocialAccountItem[]>([]);
  const [socialTransfers, setSocialTransfers] = useState<SocialTransferItem[]>([]);
  const [socialStats, setSocialStats] = useState<{
    totalAccounts: number;
    verifiedAccounts: number;
    totalTransfers: number;
    totalVolumeNim: number;
  }>({ totalAccounts: 0, verifiedAccounts: 0, totalTransfers: 0, totalVolumeNim: 0 });
  const [savingSocialConfig, setSavingSocialConfig] = useState(false);
  const [socialSavedMessage, setSocialSavedMessage] = useState<string | null>(null);

  // Promotional Banner Upload Form State (Strictly File Upload Only)
  const [bannerTitle, setBannerTitle] = useState('');
  const [bannerSubtitle, setBannerSubtitle] = useState('');
  const [bannerTargetRoute, setBannerTargetRoute] = useState('/p2p');
  const [bannerCustomRoute, setBannerCustomRoute] = useState('');
  const [bannerFileDataUrl, setBannerFileDataUrl] = useState<string>('');
  const [bannerFileName, setBannerFileName] = useState<string>('');
  const [uploadingBanner, setUploadingBanner] = useState(false);

  // Admin Red Packet Creation State (Funded directly from Admin Wallet NQ47 JQ20 R4SM 53AY 9Y9F VQKF FMJP Q6AU KURR)
  const [rpTotalNim, setRpTotalNim] = useState('500');
  const [rpSlots, setRpSlots] = useState('10');
  const [rpMode, setRpMode] = useState<'RANDOM' | 'EQUAL'>('RANDOM');
  const [rpMessage, setRpMessage] = useState('Official Nimora Community Red Packet!');
  const [pendingAdminRp, setPendingAdminRp] = useState<{
    packet: AdminRedPacketRow;
    escrowAddress: string;
  } | null>(null);
  const [selectedAdminRp, setSelectedAdminRp] = useState<AdminRedPacketRow | null>(
    null
  );
  const [creatingRp, setCreatingRp] = useState(false);

  const adminFetch = async <T,>(
    path: string,
    options: RequestInit = {},
    overrideToken?: string,
    clearSessionOnAuthFail = true
  ): Promise<T> => {
    const tokenToUse = overrideToken || adminToken;
    const headers = new Headers(options.headers || {});
    headers.set('Content-Type', 'application/json');
    if (tokenToUse) {
      headers.set('Authorization', `Bearer ${tokenToUse}`);
      headers.set('x-admin-token', tokenToUse);
    }
    const res = await fetch(path, { ...options, headers });
    if (res.status === 401 || res.status === 403) {
      if (clearSessionOnAuthFail) {
        sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
        setAdminToken(null);
      }
      const errBody = await res.json().catch(() => ({}));
      throw new Error(
        errBody.error ||
          `Access restricted exclusively to Admin Wallet (${ADMIN_WALLET_ADDRESS})`
      );
    }
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  };

  const fetchOverview = async (tokenOverride?: string) => {
    try {
      const [res, rpRes, socialRes, cbRes] = await Promise.all([
        adminFetch<AdminOverviewPayload>(
          '/api/300210/2026/nimora/panel/only/admin/overview',
          {},
          tokenOverride,
          true
        ),
        fetch('/api/redpackets').then((r) => r.json()).catch(() => ({ redPackets: [] })),
        adminFetch<{
          config: typeof socialBotConfig;
          stats: typeof socialStats;
          socialAccounts: SocialAccountItem[];
          socialTransfers: SocialTransferItem[];
        }>('/api/300210/2026/nimora/panel/only/admin/social/config', {}, tokenOverride, false).catch(
          () => null
        ),
        adminFetch<{
          config: CashbackConfig;
          claims: CashbackClaimItem[];
          stats: typeof cashbackStats;
        }>('/api/300210/2026/nimora/panel/only/admin/cashback', {}, tokenOverride, false).catch(
          () => null
        ),
      ]);

      if (res) {
        const usersList = res.users || [];
        const ordersList = res.orders || [];
        const adsList = res.ads || [];
        const bannersList = res.banners || [];
        const activityList = res.activityLog || [];

        const safeStats: AdminStats = res.stats || {
          totalUsers: usersList.length,
          bannedUsers: usersList.filter((u) => u.isBanned).length,
          onboardedUsers: usersList.filter((u) => u.onboardingCompleted).length,
          totalAds: adsList.length,
          activeAds: adsList.filter((a) => a.status === 'ACTIVE').length,
          totalOrders: ordersList.length,
          activeOrders: ordersList.filter((o) =>
            ['AWAITING_DEPOSIT', 'CRYPTO_LOCKED', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED', 'DISPUTED'].includes(o.status)
          ).length,
          disputedOrders: ordersList.filter((o) => o.status === 'DISPUTED').length,
          completedOrders: ordersList.filter((o) => o.status === 'COMPLETED').length,
          totalVolumeNim: ordersList
            .filter((o) => o.status === 'COMPLETED')
            .reduce((acc, o) => acc + (o.amountNim || 0), 0),
          totalPaymentRequests: res.requests?.length || 0,
          totalRedPackets: res.redPackets?.length || 0,
          totalBanners: bannersList.length,
          escrowAddress: ADMIN_WALLET_ADDRESS,
          adminWalletAddress: ADMIN_WALLET_ADDRESS,
        };

        const safePayload: AdminOverviewPayload = {
          ...res,
          stats: safeStats,
          users: usersList,
          orders: ordersList,
          ads: adsList,
          banners: bannersList,
          activityLog: activityList,
        };
        setData(safePayload);
      }

      const allPackets: AdminRedPacketRow[] = rpRes.redPackets || [];
      setRedPackets(allPackets);
      if (!selectedAdminRp && allPackets.length > 0) {
        setSelectedAdminRp(allPackets[0]);
      }
      if (socialRes) {
        if (socialRes.config) {
          setSocialBotConfig(socialRes.config);
          if (!socialFormDirty) {
            setTwitterCookiesInput(socialRes.config.twitterCookies || '');
            setTelegramBotTokenInput(
              socialRes.config.telegramBotToken || '8834505856:AAFzOkTpf7MXL3CbqwzR-E-y61n4N20hOuw'
            );
          }
        }
        if (socialRes.stats) setSocialStats(socialRes.stats);
        if (socialRes.socialAccounts) setSocialAccounts(socialRes.socialAccounts);
        if (socialRes.socialTransfers) setSocialTransfers(socialRes.socialTransfers);
      }
      const activeCbConfig = cbRes?.config || res?.cashbackConfig;
      if (activeCbConfig) {
        setCashbackConfig(activeCbConfig);
        if (!cbFormDirty) {
          setCbMinTxInput(String(activeCbConfig.minTxAmountNim ?? 1500));
          setCbMinCashbackInput(String(activeCbConfig.minCashbackNim ?? 200));
          setCbMaxCashbackInput(String(activeCbConfig.maxCashbackNim ?? 5000));
        }
      }
      if (cbRes?.claims) setCashbackClaims(cbRes.claims);
      else if (res?.cashbackClaims) setCashbackClaims(res.cashbackClaims);
      if (cbRes?.stats) setCashbackStats(cbRes.stats);
      setErrorBanner(null);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to load data');
    }
  };

  const handleSaveSocialConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSocialConfig(true);
    setSocialSavedMessage(null);
    setErrorBanner(null);
    try {
      const payload = {
        twitterCookies: twitterCookiesInput,
        telegramBotToken: telegramBotTokenInput.trim(),
        isListening: socialBotConfig.isListening,
        autoReply: socialBotConfig.autoReply,
      };
      const res = await adminFetch<{ success: boolean; config: typeof socialBotConfig }>(
        '/api/300210/2026/nimora/panel/only/admin/social/config',
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
      setSocialBotConfig(res.config);
      setTwitterCookiesInput(res.config.twitterCookies || '');
      setTelegramBotTokenInput(res.config.telegramBotToken || '');
      setSocialFormDirty(false);
      setSocialSavedMessage(
        'Configurations saved successfully! Telegram Bot & X @nimorapay listener are now active.'
      );
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to save social bot config');
    } finally {
      setSavingSocialConfig(false);
    }
  };

  const handleToggleCashbackActive = async () => {
    const nextActive = !cashbackConfig.isActive;
    if (nextActive && cashbackConfig.escrowBalanceNim <= 0) {
      setErrorBanner('Cannot activate cashback: Escrow wallet balance is 0 NIM. Please deposit funds into the escrow wallet first.');
      setEscrowDepositModalOpen(true);
      return;
    }
    setSavingCashbackConfig(true);
    setCashbackSuccessMessage(null);
    setErrorBanner(null);
    try {
      const res = await adminFetch<{ success: boolean; config: CashbackConfig }>(
        '/api/300210/2026/nimora/panel/only/admin/cashback/config',
        {
          method: 'POST',
          body: JSON.stringify({ isActive: nextActive }),
        }
      );
      setCashbackConfig(res.config);
      setCashbackSuccessMessage(
        nextActive
          ? '🎉 Cashback feature is now ACTIVE! Eligible users will unlock random rewards on P2P sales, tips, and red packets.'
          : 'Cashback feature has been deactivated.'
      );
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to toggle cashback status');
    } finally {
      setSavingCashbackConfig(false);
    }
  };

  const handleSaveCashbackThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCashbackConfig(true);
    setCashbackSuccessMessage(null);
    setErrorBanner(null);
    try {
      const res = await adminFetch<{ success: boolean; config: CashbackConfig }>(
        '/api/300210/2026/nimora/panel/only/admin/cashback/config',
        {
          method: 'POST',
          body: JSON.stringify({
            minTxAmountNim: parseFloat(cbMinTxInput) || 1500,
            minCashbackNim: parseFloat(cbMinCashbackInput) || 200,
            maxCashbackNim: parseFloat(cbMaxCashbackInput) || 5000,
          }),
        }
      );
      setCashbackConfig(res.config);
      setCbMinTxInput(String(res.config.minTxAmountNim));
      setCbMinCashbackInput(String(res.config.minCashbackNim));
      setCbMaxCashbackInput(String(res.config.maxCashbackNim));
      setCbFormDirty(false);
      setCashbackSuccessMessage(`Cashback thresholds saved successfully! Min tx required set to ${res.config.minTxAmountNim} NIM.`);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update cashback thresholds');
    } finally {
      setSavingCashbackConfig(false);
    }
  };

  const handleDepositCashbackEscrow = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(depositAmountInput);
    if (!amount || isNaN(amount) || amount <= 0) {
      setErrorBanner('Please enter a valid deposit amount in NIM');
      return;
    }
    setDepositingEscrow(true);
    setCashbackSuccessMessage(null);
    setErrorBanner(null);
    try {
      const res = await adminFetch<{ success: boolean; config: CashbackConfig; txHash: string }>(
        '/api/300210/2026/nimora/panel/only/admin/cashback/deposit',
        {
          method: 'POST',
          body: JSON.stringify({
            amountNim: amount,
            txHash: depositTxHashInput.trim() || undefined,
            note: depositNoteInput.trim() || undefined,
          }),
        }
      );
      setCashbackConfig(res.config);
      setEscrowDepositModalOpen(false);
      setDepositAmountInput('25000');
      setDepositTxHashInput('');
      setCashbackSuccessMessage(
        `Successfully deposited ${formatNim(amount)} into the Cashback Escrow pool! Escrow Balance: ${formatNim(
          res.config.escrowBalanceNim
        )}`
      );
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to deposit to escrow wallet');
    } finally {
      setDepositingEscrow(false);
    }
  };

  const handleConfirmCashbackClaim = async (claim: CashbackClaimItem) => {
    if (cashbackConfig.escrowBalanceNim < claim.cashbackAmountNim) {
      setErrorBanner(
        `Cannot confirm claim: Escrow pool balance (${formatNim(
          cashbackConfig.escrowBalanceNim
        )}) is lower than reward amount (${formatNim(
          claim.cashbackAmountNim
        )}). Please deposit into the escrow wallet first.`
      );
      setEscrowDepositModalOpen(true);
      return;
    }
    setProcessingClaimId(claim.id);
    setCashbackSuccessMessage(null);
    setErrorBanner(null);
    try {
      const res = await adminFetch<{
        success: boolean;
        claim: CashbackClaimItem;
        txHash: string;
        message: string;
      }>(`/api/300210/2026/nimora/panel/only/admin/cashback/claims/${claim.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ notes: 'Confirmed by Admin — manual anti-fraud check passed.' }),
      });
      setCashbackSuccessMessage(
        `🎉 ${res.message} On-chain payout tx: ${res.txHash.slice(0, 14)}…`
      );
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to confirm cashback claim');
    } finally {
      setProcessingClaimId(null);
    }
  };

  const handleRejectCashbackClaim = async () => {
    if (!rejectingClaimId) return;
    setProcessingClaimId(rejectingClaimId);
    setCashbackSuccessMessage(null);
    setErrorBanner(null);
    try {
      await adminFetch(
        `/api/300210/2026/nimora/panel/only/admin/cashback/claims/${rejectingClaimId}/reject`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: rejectReasonInput }),
        }
      );
      setCashbackSuccessMessage('Cashback claim rejected and archived.');
      setRejectingClaimId(null);
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to reject claim');
    } finally {
      setProcessingClaimId(null);
    }
  };


  // Detect current wallet on mount so it's clearly visible on the login gate
  useEffect(() => {
    getWalletAccount()
      .then((acc) => {
        if (acc?.address) {
          setConnectedWallet(normalizeNimiqAddress(acc.address));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!adminToken) return;
    fetchOverview();

    let ws: WebSocket | null = null;
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (
            msg.event === 'ADMIN_ACTIVITY' ||
            msg.event === 'ORDER_UPDATED' ||
            msg.event === 'BANNERS_UPDATED' ||
            msg.event === 'REDPACKET_CLAIMED' ||
            msg.event === 'CASHBACK_CLAIM_UPDATED'
          ) {
            fetchOverview();
          }
        } catch {
          // Ignore
        }
      };
      ws.onerror = () => {
        // Suppress websocket connection errors
      };
    } catch {
      // Ignore websocket creation errors
    }

    const interval = setInterval(() => fetchOverview(), 8000);
    return () => {
      if (ws) ws.close();
      clearInterval(interval);
    };
  }, [adminToken]);

  const handleWalletSignIn = async (enforceAdminAddress = false) => {
    setLoggingIn(true);
    setAuthError(null);
    setLoginStepStatus('Detecting connected wallet account...');
    try {
      if (enforceAdminAddress) {
        setMockWalletAddress(ADMIN_WALLET_ADDRESS);
      }
      const acc = await getWalletAccount();
      let addressToUse = normalizeNimiqAddress(acc.address);

      if (normalizeNimiqAddress(addressToUse) !== ADMIN_WALLET_ADDRESS) {
        if (!isInsideNimiqPay() || enforceAdminAddress) {
          // In developer preview or browser sandbox, automatically switch mock wallet to admin
          setMockWalletAddress(ADMIN_WALLET_ADDRESS);
          addressToUse = ADMIN_WALLET_ADDRESS;
        } else {
          throw new Error(
            `Unauthorized wallet (${addressToUse}). Only authorized Admin Wallet (${ADMIN_WALLET_ADDRESS}) can access this panel. Switch your connected wallet or use the Admin Password option.`
          );
        }
      }

      setConnectedWallet(addressToUse);
      setLoginStepStatus('Requesting cryptographic authentication challenge...');

      // 1. Request challenge for the admin wallet
      const challenge = await fetch(
        '/api/300210/2026/nimora/panel/only/admin/challenge',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: addressToUse }),
        }
      );
      if (!challenge.ok) {
        const err = await challenge.json().catch(() => ({}));
        throw new Error(err.error || 'Admin wallet challenge rejected');
      }
      const challengeData = (await challenge.json()) as {
        nonce: string;
        message: string;
      };

      setLoginStepStatus('Signing challenge message with admin key...');
      // 2. Sign the challenge with the connected wallet
      const signed = await signChallengeMessage(challengeData.message);

      setLoginStepStatus('Verifying cryptographic signature on backend...');
      // 3. Authenticate with the backend
      const loginRes = await fetch(
        '/api/300210/2026/nimora/panel/only/admin/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: addressToUse,
            nonce: challengeData.nonce,
            signature: signed.signature,
            publicKey: signed.publicKey,
          }),
        }
      );

      if (!loginRes.ok) {
        const err = await loginRes.json().catch(() => ({}));
        throw new Error(err.error || 'Admin wallet verification failed');
      }

      const verified = (await loginRes.json()) as {
        token: string;
        adminAddress: string;
      };

      setLoginStepStatus('Access granted. Loading command center...');
      sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, verified.token);
      setConnectedWallet(verified.adminAddress);
      setAdminToken(verified.token);
      await fetchOverview(verified.token);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Admin wallet authentication failed'
      );
    } finally {
      setLoggingIn(false);
      setLoginStepStatus(null);
    }
  };

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPasswordInput.trim()) {
      setAuthError('Please enter the administrator secret password');
      return;
    }
    setLoggingIn(true);
    setAuthError(null);
    setLoginStepStatus('Verifying root administrator credentials...');
    try {
      const loginRes = await fetch(
        '/api/300210/2026/nimora/panel/only/admin/login',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password: adminPasswordInput.trim(),
          }),
        }
      );

      if (!loginRes.ok) {
        const err = await loginRes.json().catch(() => ({}));
        throw new Error(err.error || 'Admin verification failed: Invalid password');
      }

      const verified = (await loginRes.json()) as {
        token: string;
        adminAddress: string;
      };

      setLoginStepStatus('Admin credentials authenticated. Loading command center...');
      sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, verified.token);
      setConnectedWallet(verified.adminAddress || ADMIN_WALLET_ADDRESS);
      setAdminToken(verified.token);
      await fetchOverview(verified.token);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Admin authentication failed'
      );
    } finally {
      setLoggingIn(false);
      setLoginStepStatus(null);
    }
  };

  const handleToggleUserBan = async (u: AdminUserRow) => {
    setActionBusy(u.id);
    try {
      await adminFetch(`/api/300210/2026/nimora/panel/only/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isBanned: !u.isBanned }),
      });
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setActionBusy(null);
    }
  };

  const handleResetOnboarding = async (u: AdminUserRow) => {
    setActionBusy(u.id);
    try {
      await adminFetch(`/api/300210/2026/nimora/panel/only/admin/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resetOnboarding: true }),
      });
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setActionBusy(null);
    }
  };

  const handleResolveOrder = async (
    orderId: string,
    resolution: 'RELEASE_TO_BUYER' | 'REFUND_TO_SELLER'
  ) => {
    setActionBusy(orderId);
    try {
      await adminFetch(
        `/api/300210/2026/nimora/panel/only/admin/orders/${orderId}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({ resolution }),
        }
      );
      setInspectOrder(null);
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Resolution failed');
    } finally {
      setActionBusy(null);
    }
  };

  const handleCloseAd = async (adId: string) => {
    setActionBusy(adId);
    try {
      await adminFetch(
        `/api/300210/2026/nimora/panel/only/admin/ads/${adId}/close`,
        {
          method: 'POST',
        }
      );
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to close ad');
    } finally {
      setActionBusy(null);
    }
  };

  const handleBannerFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorBanner('Please select a valid image file (PNG, JPG, WEBP).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setBannerFileDataUrl(reader.result);
        setBannerFileName(file.name);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreateBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bannerFileDataUrl) {
      setErrorBanner('Please upload an image file from your device.');
      return;
    }
    const finalTargetRoute =
      bannerTargetRoute === 'CUSTOM'
        ? bannerCustomRoute.trim() || '/p2p'
        : bannerTargetRoute;

    setUploadingBanner(true);
    setErrorBanner(null);
    try {
      await adminFetch('/api/300210/2026/nimora/panel/only/admin/banners', {
        method: 'POST',
        body: JSON.stringify({
          title: bannerTitle.trim(),
          subtitle: bannerSubtitle.trim(),
          imageDataUrl: bannerFileDataUrl,
          targetRoute: finalTargetRoute,
        }),
      });
      setBannerTitle('');
      setBannerSubtitle('');
      setBannerFileDataUrl('');
      setBannerFileName('');
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to upload banner');
    } finally {
      setUploadingBanner(false);
    }
  };

  const handleToggleBanner = async (bannerId: string) => {
    setActionBusy(bannerId);
    try {
      await adminFetch(
        `/api/300210/2026/nimora/panel/only/admin/banners/${bannerId}`,
        {
          method: 'PATCH',
        }
      );
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to toggle banner');
    } finally {
      setActionBusy(null);
    }
  };

  const handleDeleteBanner = async (bannerId: string) => {
    setActionBusy(bannerId);
    try {
      await adminFetch(
        `/api/300210/2026/nimora/panel/only/admin/banners/${bannerId}`,
        {
          method: 'DELETE',
        }
      );
      await fetchOverview();
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to delete banner');
    } finally {
      setActionBusy(null);
    }
  };

  // Create Red Packet from Admin Panel & Fund via Admin Wallet NQ47 JQ20 R4SM 53AY 9Y9F VQKF FMJP Q6AU KURR
  const handleAdminCreateRedPacket = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingRp(true);
    setErrorBanner(null);
    try {
      const res = await adminFetch<{
        redPacket: AdminRedPacketRow;
        escrowAddress: string;
        adminWalletAddress: string;
      }>('/api/300210/2026/nimora/panel/only/admin/redpackets', {
        method: 'POST',
        body: JSON.stringify({
          totalNim: Number(rpTotalNim),
          slots: Number(rpSlots),
          mode: rpMode,
          message: rpMessage.trim() || 'Official Nimora Red Packet!',
        }),
      });
      setPendingAdminRp({
        packet: res.redPacket,
        escrowAddress: res.escrowAddress,
      });
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to create Admin Red Packet'
      );
    } finally {
      setCreatingRp(false);
    }
  };

  const handleAdminConfirmRedPacketDeposit = async () => {
    if (!pendingAdminRp) return;
    setCreatingRp(true);
    setErrorBanner(null);
    try {
      // Trigger Nimiq Pay payment from the signed-in Admin Wallet
      const tx = await sendNim({
        recipient: pendingAdminRp.escrowAddress,
        amountNim: pendingAdminRp.packet.totalNim,
        data: `packet:${pendingAdminRp.packet.id}`,
      });

      const activated = await adminFetch<{ redPacket: AdminRedPacketRow }>(
        `/api/300210/2026/nimora/panel/only/admin/redpackets/${pendingAdminRp.packet.slug}/deposit`,
        {
          method: 'POST',
          body: JSON.stringify({ txHash: tx.txHash }),
        }
      );

      setPendingAdminRp(null);
      setSelectedAdminRp(activated.redPacket);
      await fetchOverview();
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Admin wallet deposit failed'
      );
    } finally {
      setCreatingRp(false);
    }
  };

  // ============================================================================
  // WALLET-RESTRICTED GATE SCREEN
  // ============================================================================
  if (!adminToken) {
    const isMatchedAdminWallet =
      normalizeNimiqAddress(connectedWallet) === ADMIN_WALLET_ADDRESS;

    return (
      <div className="min-h-screen bg-navy-950 text-slate-100 flex flex-col justify-center items-center px-4 py-8">
        <div className="w-full max-w-md bg-navy-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md space-y-6">
          {/* Header */}
          <div className="text-center space-y-2">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-navy-950 font-black text-3xl font-display shadow-xl shadow-gold-500/20 mx-auto">
              N
            </div>
            <h1 className="text-2xl font-extrabold text-white font-display tracking-tight flex items-center justify-center gap-2">
              <span>Nimora Admin Center</span>
              <Shield className="w-5 h-5 text-gold-400" />
            </h1>
            <p className="text-xs text-slate-400">
              Restricted management console · Admin authentication required
            </p>
          </div>

          {/* Admin Wallet Authorization Status Banner */}
          <div className="rounded-2xl bg-navy-950 border border-slate-800 p-3.5 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Authorized Admin Wallet
              </span>
              <span className="px-2 py-0.5 rounded bg-gold-500/15 border border-gold-500/30 text-gold-300 font-mono text-[10px] font-bold">
                ROOT OWNER
              </span>
            </div>
            <div className="font-mono text-[11px] text-white bg-navy-900/80 px-2.5 py-1.5 rounded-lg border border-slate-800 break-all select-all">
              {ADMIN_WALLET_ADDRESS}
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-400 text-[11px]">Active Wallet:</span>
              <span
                className={`font-mono text-[11px] font-bold ${
                  isMatchedAdminWallet ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {connectedWallet ? shortenAddress(connectedWallet) : 'Detecting...'}
              </span>
            </div>
          </div>

          {/* Authentication Mode Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-navy-950 border border-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setAdminAuthMode('WALLET');
                setAuthError(null);
              }}
              className={`flex-1 min-h-[38px] rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                adminAuthMode === 'WALLET'
                  ? 'bg-gold-500 text-navy-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Wallet className="w-4 h-4" />
              <span>Admin Wallet</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAdminAuthMode('PASSWORD');
                setAuthError(null);
              }}
              className={`flex-1 min-h-[38px] rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                adminAuthMode === 'PASSWORD'
                  ? 'bg-gold-500 text-navy-950 shadow-md'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Key className="w-4 h-4" />
              <span>Master Password</span>
            </button>
          </div>

          {/* Feedback & In-Flight Status Messages */}
          {loginStepStatus && (
            <div className="rounded-xl bg-gold-500/10 border border-gold-500/30 p-3 text-xs text-gold-300 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin shrink-0 text-gold-400" />
              <span>{loginStepStatus}</span>
            </div>
          )}

          {authError && (
            <div className="rounded-xl bg-red-950/70 border border-red-500/40 p-3.5 text-xs text-red-200 space-y-2 text-start">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span className="leading-snug">{authError}</span>
              </div>
              {!isMatchedAdminWallet && adminAuthMode === 'WALLET' && (
                <button
                  type="button"
                  onClick={() => handleWalletSignIn(true)}
                  className="w-full min-h-[34px] rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-[11px] font-bold text-red-100 flex items-center justify-center gap-1"
                >
                  <span>Connect Official Admin Wallet & Retry</span>
                </button>
              )}
            </div>
          )}

          {/* Tab 1: Wallet Authentication */}
          {adminAuthMode === 'WALLET' && (
            <div className="space-y-3">
              <button
                type="button"
                disabled={loggingIn}
                onClick={() => handleWalletSignIn(true)}
                className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-400 hover:to-gold-500 text-navy-950 font-bold text-sm shadow-lg shadow-gold-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {loggingIn ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Signing In as Admin…</span>
                  </>
                ) : (
                  <>
                    <Wallet className="w-4 h-4" />
                    <span>Sign In with Admin Wallet</span>
                  </>
                )}
              </button>

              <p className="text-[11px] text-slate-400 text-center leading-relaxed">
                Signs challenge with authorized address{' '}
                <span className="font-mono text-gold-400">
                  {shortenAddress(ADMIN_WALLET_ADDRESS)}
                </span>
              </p>
            </div>
          )}

          {/* Tab 2: Password Authentication */}
          {adminAuthMode === 'PASSWORD' && (
            <form onSubmit={handlePasswordSignIn} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Administrator Master Password
                </label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    autoFocus
                    value={adminPasswordInput}
                    onChange={(e) => setAdminPasswordInput(e.target.value)}
                    placeholder="Enter admin password…"
                    className="w-full h-11 px-3.5 pr-10 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-gold-500 font-mono"
                  />
                  <Lock className="w-4 h-4 text-slate-500 absolute right-3 top-3.5 pointer-events-none" />
                </div>
              </div>

              <button
                type="submit"
                disabled={loggingIn || !adminPasswordInput.trim()}
                className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 hover:from-gold-400 hover:to-gold-500 text-navy-950 font-bold text-sm shadow-lg shadow-gold-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {loggingIn ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Authenticating…</span>
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4" />
                    <span>Authenticate & Enter</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* Back to App Link */}
          <div className="pt-2 border-t border-slate-800/80 text-center">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="text-xs text-slate-400 hover:text-white transition-colors"
            >
              ← Return to Nimora Mini App
            </button>
          </div>
        </div>
      </div>
    );
  }

  const filteredUsers =
    data?.users?.filter((u) => {
      if (countryFilter !== 'ALL' && u.country !== countryFilter) return false;
      if (!userSearch.trim()) return true;
      const q = userSearch.toLowerCase();
      return (
        u.address.toLowerCase().includes(q) ||
        (u.realName && u.realName.toLowerCase().includes(q)) ||
        (u.country && u.country.toLowerCase().includes(q))
      );
    }) || [];

  const filteredOrders =
    data?.orders?.filter((o) => {
      if (orderFilter === 'DISPUTED') return o.status === 'DISPUTED';
      if (orderFilter === 'ACTIVE') {
        return [
          'AWAITING_DEPOSIT',
          'CRYPTO_LOCKED',
          'AWAITING_PAYMENT',
          'PAYMENT_SUBMITTED',
          'DISPUTED',
        ].includes(o.status);
      }
      return true;
    }) || [];

  const adminQrLinks = selectedAdminRp
    ? encodeRedPacketQR(selectedAdminRp.slug)
    : null;

  return (
    <div className="min-h-screen bg-navy-950 text-slate-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-navy-950/90 backdrop-blur-md border-b border-slate-800/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-navy-950 font-black font-display">
              N
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white font-display text-sm sm:text-base">
                  Nimora Admin Command Center
                </span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono">
                  {shortenAddress(connectedWallet || ADMIN_WALLET_ADDRESS)}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 font-mono hidden sm:block">
                Wallet-Authenticated: {ADMIN_WALLET_ADDRESS}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <a
              href="/api/demo/NIMORA/test"
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[38px] px-3.5 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition-all"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Launch Demo Wallet (250k NIM)</span>
              <span className="sm:hidden">Demo</span>
            </a>
            <button
              type="button"
              onClick={() => fetchOverview()}
              className="min-h-[38px] px-3 rounded-xl bg-navy-900 border border-slate-800 hover:border-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5 text-gold-400" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => {
                sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
                setAdminToken(null);
              }}
              className="min-h-[38px] px-3.5 rounded-xl bg-red-950/60 border border-red-500/40 text-xs font-semibold text-red-200 hover:bg-red-900/50"
            >
              Lock Panel
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {errorBanner && (
          <div className="rounded-xl bg-red-950/70 border border-red-500/40 p-3.5 text-xs text-red-200 flex items-center justify-between">
            <span>{errorBanner}</span>
            <button
              type="button"
              onClick={() => setErrorBanner(null)}
              className="text-red-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* KPI Metrics Strip */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-4">
              <div className="text-[11px] text-slate-400">Total Users</div>
              <div className="text-2xl font-extrabold text-white font-mono tabular-nums mt-1">
                {data.stats?.totalUsers ?? data.users?.length ?? 0}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {data.stats?.onboardedUsers ?? 0} onboarded · {data.stats?.bannedUsers ?? 0} banned
              </div>
            </div>

            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-4">
              <div className="text-[11px] text-slate-400">Active P2P Orders</div>
              <div className="text-2xl font-extrabold text-gold-400 font-mono tabular-nums mt-1">
                {data.stats?.activeOrders ?? 0}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {data.stats?.completedOrders ?? 0} completed
              </div>
            </div>

            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-4">
              <div className="text-[11px] text-slate-400">Open Disputes</div>
              <div
                className={`text-2xl font-extrabold font-mono tabular-nums mt-1 ${
                  (data.stats?.disputedOrders ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'
                }`}
              >
                {data.stats?.disputedOrders ?? 0}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Escrow arbitration queue
              </div>
            </div>

            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-4">
              <div className="text-[11px] text-slate-400">Settled Volume</div>
              <div className="text-xl font-extrabold text-emerald-400 font-mono tabular-nums mt-1">
                {formatNim(data.stats?.totalVolumeNim ?? 0)}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Across {data.stats?.activeAds ?? 0} active ads
              </div>
            </div>

            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-4">
              <div className="text-[11px] text-slate-400">Home Banners</div>
              <div className="text-2xl font-extrabold text-sky-400 font-mono tabular-nums mt-1">
                {(data.banners || []).filter((b) => b.isActive).length} / {data.banners?.length ?? 0}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Swipeable on Home
              </div>
            </div>

            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-4">
              <div className="text-[11px] text-slate-400">Red Packets</div>
              <div className="text-2xl font-extrabold text-rose-400 font-mono tabular-nums mt-1">
                {redPackets.length}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                Funded by Escrow
              </div>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3">
          <button
            type="button"
            onClick={() => setActiveTab('MONITOR')}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
              activeTab === 'MONITOR'
                ? 'bg-gold-500 text-navy-950'
                : 'bg-navy-900 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <Activity className="w-4 h-4" />
            <span>Real-Time Activity ({data?.activityLog?.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('REDPACKETS')}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
              activeTab === 'REDPACKETS'
                ? 'bg-gold-500 text-navy-950'
                : 'bg-navy-900 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <Gift className="w-4 h-4" />
            <span>Admin Red Packets ({redPackets.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('USERS')}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
              activeTab === 'USERS'
                ? 'bg-gold-500 text-navy-950'
                : 'bg-navy-900 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>User Management ({data?.users.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ORDERS')}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
              activeTab === 'ORDERS'
                ? 'bg-gold-500 text-navy-950'
                : 'bg-navy-900 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <Scale className="w-4 h-4" />
            <span>
              Orders & Disputes ({data?.orders.length || 0})
              {data && data.stats.disputedOrders > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded bg-red-500 text-white text-[10px]">
                  {data.stats.disputedOrders}
                </span>
              )}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('BANNERS')}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
              activeTab === 'BANNERS'
                ? 'bg-gold-500 text-navy-950'
                : 'bg-navy-900 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <ImagePlus className="w-4 h-4" />
            <span>Home Banners ({data?.banners.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ADS')}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
              activeTab === 'ADS'
                ? 'bg-gold-500 text-navy-950'
                : 'bg-navy-900 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>P2P Ads ({data?.ads.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('SOCIAL')}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
              activeTab === 'SOCIAL'
                ? 'bg-gold-500 text-navy-950'
                : 'bg-navy-900 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <AtSign className="w-4 h-4" />
            <span>Social Bot & X Cookies ({socialStats.totalTransfers})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('CASHBACK')}
            className={`min-h-[40px] px-4 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
              activeTab === 'CASHBACK'
                ? 'bg-gold-500 text-navy-950'
                : 'bg-navy-900 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <Coins className="w-4 h-4 text-amber-400" />
            <span>Cashback & Escrow</span>
            {cashbackStats.pendingClaimsCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-500 text-white animate-pulse">
                {cashbackStats.pendingClaimsCount} pending
              </span>
            )}
          </button>
        </div>

        {/* TAB: ADMIN RED PACKETS (Funded by Admin Wallet NQ47 JQ20 R4SM 53AY 9Y9F VQKF FMJP Q6AU KURR) */}
        {activeTab === 'REDPACKETS' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <form
              onSubmit={handleAdminCreateRedPacket}
              className="lg:col-span-6 rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white font-display flex items-center gap-2">
                    <Gift className="w-5 h-5 text-rose-400" />
                    <span>Create Official Admin Red Packet</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Funded directly from your signed-in Admin Wallet ({shortenAddress(ADMIN_WALLET_ADDRESS)}).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRpMode('RANDOM')}
                  className={`min-h-[42px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 ${
                    rpMode === 'RANDOM'
                      ? 'bg-rose-500 text-white'
                      : 'bg-navy-950 text-slate-300 border border-slate-800'
                  }`}
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Lucky Random Split</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRpMode('EQUAL')}
                  className={`min-h-[42px] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 ${
                    rpMode === 'EQUAL'
                      ? 'bg-gold-500 text-navy-950'
                      : 'bg-navy-950 text-slate-300 border border-slate-800'
                  }`}
                >
                  <Gift className="w-4 h-4" />
                  <span>Equal Split</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    Total NIM to Lock
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    step="any"
                    value={rpTotalNim}
                    onChange={(e) => setRpTotalNim(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    Number of Recipients
                  </label>
                  <input
                    type="number"
                    required
                    min={2}
                    max={200}
                    value={rpSlots}
                    onChange={(e) => setRpSlots(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1">
                  Greeting Message
                </label>
                <input
                  type="text"
                  maxLength={140}
                  value={rpMessage}
                  onChange={(e) => setRpMessage(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white"
                />
              </div>

              <button
                type="submit"
                disabled={creatingRp}
                className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-rose-500 to-gold-500 text-white font-bold text-xs flex items-center justify-center gap-2 hover:brightness-105"
              >
                <Wallet className="w-4 h-4" />
                <span>
                  {creatingRp
                    ? 'Preparing Escrow Deposit…'
                    : `Create & Pay ${rpTotalNim} NIM from Admin Wallet`}
                </span>
              </button>

              {redPackets.length > 0 && (
                <div className="pt-4 border-t border-slate-800 space-y-2.5">
                  <div className="text-xs font-bold text-slate-300">
                    All Red Packets ({redPackets.length})
                  </div>
                  {redPackets.map((p) => (
                    <div
                      key={p.id}
                      onClick={() => setSelectedAdminRp(p)}
                      className={`cursor-pointer rounded-xl p-3 border text-xs flex items-center justify-between transition-colors ${
                        selectedAdminRp?.id === p.id
                          ? 'bg-rose-500/15 border-rose-500/40 text-white'
                          : 'bg-navy-950 border-slate-800 text-slate-300'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-white">
                          {formatNim(p.totalNim)} ({p.mode}) · Claimed {p.claims.length}/
                          {p.slots}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          By {p.creatorName} · Status: {p.status}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          navigate(`/rp/${p.slug}`);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 font-semibold"
                      >
                        Open Link
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </form>

            <div className="lg:col-span-6">
              {selectedAdminRp && adminQrLinks ? (
                <QRCard
                  title={`${selectedAdminRp.creatorName} · ${selectedAdminRp.mode} Red Packet`}
                  subtitle={`"${selectedAdminRp.message}" · Claimed ${selectedAdminRp.claims.length}/${selectedAdminRp.slots}`}
                  amountLabel={`${formatNim(selectedAdminRp.totalNim)}`}
                  qrValue={adminQrLinks.deepLink}
                  shareUrl={adminQrLinks.webLink}
                />
              ) : (
                <div className="rounded-2xl bg-navy-900 border border-slate-800 p-8 text-center text-xs text-slate-400">
                  Create & fund an Admin Red Packet on the left to generate a shareable QR code and claim link.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 1: REAL-TIME ACTIVITY MONITOR */}
        {activeTab === 'MONITOR' && data && (
          <div className="rounded-2xl bg-navy-900 border border-slate-800 overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                <h2 className="text-sm font-bold text-white font-display">
                  Live Real-Time Platform Event Stream
                </h2>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                WebSocket Connected · Auto-updating
              </span>
            </div>

            <div className="divide-y divide-slate-800/70 max-h-[600px] overflow-y-auto">
              {(data.activityLog || []).length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No activity events recorded yet. Platform actions will stream live here.
                </div>
              ) : (
                (data.activityLog || []).map((ev) => (
                  <div
                    key={ev.id}
                    className="p-4 hover:bg-navy-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold ${
                            ev.category === 'ADMIN'
                              ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                              : ev.category === 'P2P_ORDER'
                              ? 'bg-gold-500/20 text-gold-300 border border-gold-500/30'
                              : ev.category === 'AUTH'
                              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                              : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {ev.category}
                        </span>
                        <span className="font-mono font-bold text-white">
                          {ev.action}
                        </span>
                        {ev.actorName && (
                          <span className="text-slate-400">
                            by <strong className="text-slate-200">{ev.actorName}</strong>
                          </span>
                        )}
                        {ev.actorAddress && (
                          <span className="font-mono text-slate-500">
                            ({shortenAddress(ev.actorAddress)})
                          </span>
                        )}
                      </div>
                      <div className="text-slate-300">{ev.details}</div>
                    </div>

                    <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400 shrink-0">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      <span>{new Date(ev.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 2: USER MANAGEMENT */}
        {activeTab === 'USERS' && data && (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search by real name, Nimiq wallet address, or country…"
                className="flex-1 h-11 px-4 rounded-xl bg-navy-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-gold-500"
              />

              <select
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                className="h-11 px-3.5 rounded-xl bg-navy-900 border border-slate-800 text-xs text-white"
              >
                <option value="ALL">All Countries</option>
                {Object.values(SUPPORTED_REGIONS).map((r) => (
                  <option key={r.country} value={r.country}>
                    {r.flag} {r.countryName} ({r.currency})
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-2xl bg-navy-900 border border-slate-800 overflow-x-auto shadow-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                    <th className="p-3.5">User / Real Name</th>
                    <th className="p-3.5">Nimiq Wallet</th>
                    <th className="p-3.5">Locked Country</th>
                    <th className="p-3.5">Stats</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Admin Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredUsers.map((u) => {
                    const reg = u.country ? SUPPORTED_REGIONS[u.country] : null;
                    return (
                      <tr key={u.id} className="hover:bg-navy-950/50">
                        <td className="p-3.5">
                          <div className="font-bold text-white">
                            {u.realName || 'Not Onboarded'}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono">
                            ID: {u.id} · Locale: {u.locale}
                          </div>
                        </td>
                        <td className="p-3.5 font-mono text-gold-400">
                          {shortenAddress(u.address)}
                        </td>
                        <td className="p-3.5">
                          {reg ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span>{reg.flag}</span>
                              <span className="text-white font-medium">
                                {reg.countryName}
                              </span>
                              <span className="font-mono text-slate-400">
                                ({reg.currency})
                              </span>
                            </span>
                          ) : (
                            <span className="text-slate-500">Unassigned</span>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-slate-300">
                          {u.completedTrades} trades · {u.activeAdsCount} ads ·{' '}
                          {u.paymentMethodsCount} banks
                        </td>
                        <td className="p-3.5">
                          {u.isBanned ? (
                            <span className="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-red-300 font-semibold text-[11px]">
                              BANNED
                            </span>
                          ) : u.onboardingCompleted ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-semibold text-[11px]">
                              VERIFIED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold text-[11px]">
                              PENDING
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-right space-x-2 whitespace-nowrap">
                          {u.onboardingCompleted && (
                            <button
                              type="button"
                              disabled={actionBusy === u.id}
                              onClick={() => handleResetOnboarding(u)}
                              className="px-2.5 py-1.5 rounded-lg bg-navy-950 border border-slate-700 hover:border-amber-500/50 text-amber-300 text-[11px] font-medium"
                              title="Unlock Real Name & Country so user can re-onboard"
                            >
                              Unlock Identity
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={actionBusy === u.id}
                            onClick={() => handleToggleUserBan(u)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 ${
                              u.isBanned
                                ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                                : 'bg-red-500/20 border border-red-500/40 text-red-300'
                            }`}
                          >
                            {u.isBanned ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                <span>Unban</span>
                              </>
                            ) : (
                              <>
                                <Ban className="w-3.5 h-3.5" />
                                <span>Ban User</span>
                              </>
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: P2P ORDERS & ESCROW ARBITRATION */}
        {activeTab === 'ORDERS' && data && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {(['ALL', 'DISPUTED', 'ACTIVE'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setOrderFilter(f)}
                  className={`min-h-[36px] px-3.5 rounded-xl text-xs font-bold ${
                    orderFilter === f
                      ? 'bg-gold-500 text-navy-950'
                      : 'bg-navy-900 text-slate-300 border border-slate-800'
                  }`}
                >
                  {f === 'ALL'
                    ? 'All Orders'
                    : f === 'DISPUTED'
                    ? `Disputed (${data.stats.disputedOrders})`
                    : 'Active In-Flight'}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {filteredOrders.length === 0 ? (
                <div className="rounded-2xl bg-navy-900 border border-slate-800 p-8 text-center text-xs text-slate-400">
                  No P2P orders match the selected filter.
                </div>
              ) : (
                filteredOrders.map((o) => (
                  <div
                    key={o.id}
                    className={`rounded-2xl bg-navy-900 border p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${
                      o.status === 'DISPUTED'
                        ? 'border-red-500/60 bg-red-950/10'
                        : 'border-slate-800'
                    }`}
                  >
                    <div className="space-y-1 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-white">
                          {o.id}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-navy-950 border border-slate-700 font-mono text-gold-400 font-semibold">
                          {o.status}
                        </span>
                        <span className="text-slate-400">
                          Corridor: <strong className="text-white">{o.country}</strong> (
                          {o.fiatCurrency})
                        </span>
                      </div>

                      <div className="text-sm font-bold text-white font-mono tabular-nums">
                        {formatNim(o.amountNim)} ↔{' '}
                        <span className="text-gold-400">
                          {formatFiat(o.fiatAmount, o.fiatCurrency)}
                        </span>
                      </div>

                      <div className="text-slate-400">
                        Seller: <strong className="text-slate-200">{o.sellerName}</strong>{' '}
                        ({shortenAddress(o.sellerAddress)}) · Buyer:{' '}
                        <strong className="text-slate-200">{o.buyerName}</strong> (
                        {shortenAddress(o.buyerAddress)})
                      </div>

                      {o.disputeReason && (
                        <div className="text-red-300 font-medium mt-1">
                          Dispute Reason: “{o.disputeReason}”
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setInspectOrder(o)}
                        className="min-h-[38px] px-3.5 rounded-xl bg-navy-950 border border-slate-700 hover:border-slate-500 text-xs font-semibold text-slate-200 flex items-center gap-1.5"
                      >
                        <Eye className="w-3.5 h-3.5 text-gold-400" />
                        <span>Inspect & Arbitrate</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 4: HOME PROMOTIONAL BANNERS (FILE UPLOAD ONLY) */}
        {activeTab === 'BANNERS' && data && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <form
              onSubmit={handleCreateBanner}
              className="lg:col-span-5 rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4 shadow-xl"
            >
              <div>
                <h2 className="text-base font-bold text-white font-display flex items-center gap-2">
                  <ImagePlus className="w-4 h-4 text-gold-400" />
                  <span>Upload Home Promotional Banner</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Upload banner graphics directly from a local file (no URL inputs). When 2 or more banners are active, users can swipe/slide between them on the Home screen.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                  Banner Image File (PNG / JPG / WEBP)
                </label>
                <label className="w-full min-h-[120px] rounded-2xl bg-navy-950 border-2 border-dashed border-slate-700 hover:border-gold-500/60 p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors">
                  {bannerFileDataUrl ? (
                    <div className="w-full space-y-2 text-center">
                      <img
                        src={bannerFileDataUrl}
                        alt="Banner preview"
                        className="w-full h-32 object-cover rounded-xl border border-slate-800"
                      />
                      <div className="text-[11px] text-emerald-400 font-mono truncate">
                        Selected File: {bannerFileName}
                      </div>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-6 h-6 text-gold-400" />
                      <span className="text-xs font-semibold text-slate-200">
                        Click to choose image file from your device
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Direct file upload only (Recommended 1200×480)
                      </span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleBannerFileSelect}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1">
                  Banner Headline Title
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={bannerTitle}
                  onChange={(e) => setBannerTitle(e.target.value)}
                  placeholder="e.g. Zero-Fee Local P2P NIM Trading"
                  className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-gold-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1">
                  Subtitle / Description (Optional)
                </label>
                <input
                  type="text"
                  maxLength={200}
                  value={bannerSubtitle}
                  onChange={(e) => setBannerSubtitle(e.target.value)}
                  placeholder="e.g. Trade NIM with verified local bank accounts & 30m escrow."
                  className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-gold-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1">
                  Click Destination Setting (Where user goes when clicking banner)
                </label>
                <select
                  value={bannerTargetRoute}
                  onChange={(e) => setBannerTargetRoute(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-gold-500"
                >
                  <option value="/p2p">P2P Market (/p2p)</option>
                  <option value="/p2p?side=SELL_NIM">Buy NIM Offers (/p2p?side=SELL_NIM)</option>
                  <option value="/p2p?side=BUY_NIM">Sell NIM Offers (/p2p?side=BUY_NIM)</option>
                  <option value="/redpacket">Red Packets (/redpacket)</option>
                  <option value="/request">Payment Requests (/request)</option>
                  <option value="/scan">Scan QR (/scan)</option>
                  <option value="/profile">Profile & Post Ad (/profile)</option>
                  <option value="/history">Activity History (/history)</option>
                  <option value="CUSTOM">Custom Route or URL…</option>
                </select>
              </div>

              {bannerTargetRoute === 'CUSTOM' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    Custom Route Path
                  </label>
                  <input
                    type="text"
                    required
                    value={bannerCustomRoute}
                    onChange={(e) => setBannerCustomRoute(e.target.value)}
                    placeholder="/p2p or /redpacket"
                    className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={uploadingBanner || !bannerFileDataUrl || !bannerTitle.trim()}
                className="w-full min-h-[46px] rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-bold text-xs hover:brightness-105 disabled:opacity-45"
              >
                {uploadingBanner ? 'Publishing Banner…' : 'Publish Home Banner'}
              </button>
            </form>

            <div className="lg:col-span-7 space-y-3">
              <div className="text-xs font-bold text-slate-300">
                Uploaded Home Banners ({data.banners.length})
              </div>
              {data.banners.length === 0 ? (
                <div className="rounded-2xl bg-navy-900 border border-slate-800 p-8 text-center text-xs text-slate-400">
                  No promotional banners uploaded yet.
                </div>
              ) : (
                data.banners.map((b) => (
                  <div
                    key={b.id}
                    className="rounded-2xl bg-navy-900 border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3.5">
                      <img
                        src={b.imageDataUrl}
                        alt={b.title}
                        className="w-28 h-16 object-cover rounded-xl border border-slate-800 shrink-0"
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">
                            {b.title}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              b.isActive
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {b.isActive ? 'ACTIVE' : 'HIDDEN'}
                          </span>
                        </div>
                        {b.subtitle && (
                          <div className="text-xs text-slate-400 mt-0.5">
                            {b.subtitle}
                          </div>
                        )}
                        <div className="text-[11px] font-mono text-gold-400 mt-1">
                          Click Target: {b.targetRoute}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={actionBusy === b.id}
                        onClick={() => handleToggleBanner(b.id)}
                        className="min-h-[36px] px-3 rounded-xl bg-navy-950 border border-slate-700 text-xs text-slate-200 flex items-center gap-1.5"
                      >
                        {b.isActive ? (
                          <>
                            <ToggleRight className="w-4 h-4 text-emerald-400" />
                            <span>Active</span>
                          </>
                        ) : (
                          <>
                            <ToggleLeft className="w-4 h-4 text-slate-400" />
                            <span>Hidden</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        disabled={actionBusy === b.id}
                        onClick={() => handleDeleteBanner(b.id)}
                        className="min-h-[36px] min-w-[36px] rounded-xl bg-red-950/50 border border-red-500/40 text-red-300 flex items-center justify-center hover:bg-red-900/40"
                        title="Delete Banner"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 5: P2P ADVERTISEMENTS */}
        {activeTab === 'ADS' && data && (
          <div className="rounded-2xl bg-navy-900 border border-slate-800 overflow-x-auto shadow-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                  <th className="p-3.5">Merchant</th>
                  <th className="p-3.5">Side / Corridor</th>
                  <th className="p-3.5">Price</th>
                  <th className="p-3.5">Available / Limits</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {data.ads.map((ad) => (
                  <tr key={ad.id} className="hover:bg-navy-950/50">
                    <td className="p-3.5">
                      <div className="font-bold text-white">{ad.merchantName}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {shortenAddress(ad.merchantAddress)}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`font-bold ${
                          ad.side === 'SELL_NIM'
                            ? 'text-gold-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {ad.side}
                      </span>{' '}
                      · {ad.country} ({ad.fiatCurrency})
                    </td>
                    <td className="p-3.5 font-mono text-white font-bold">
                      {formatFiat(ad.price, ad.fiatCurrency)}
                    </td>
                    <td className="p-3.5 font-mono text-slate-300">
                      {formatNim(ad.availableNim)} ({ad.minAmountNim}–{ad.maxAmountNim})
                    </td>
                    <td className="p-3.5 font-mono">{ad.status}</td>
                    <td className="p-3.5 text-right">
                      {ad.status !== 'CLOSED' && (
                        <button
                          type="button"
                          disabled={actionBusy === ad.id}
                          onClick={() => handleCloseAd(ad.id)}
                          className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-[11px] font-bold"
                        >
                          Delist Ad
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB: SOCIAL BOT & X ACCOUNT COOKIES CONFIGURATION */}
        {activeTab === 'SOCIAL' && (
          <div className="space-y-6">
            {/* Success message banner */}
            {socialSavedMessage && (
              <div className="rounded-xl bg-emerald-950/60 border border-emerald-500/40 p-4 text-xs text-emerald-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{socialSavedMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setSocialSavedMessage(null)}
                  className="text-emerald-300 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Top KPI Metrics Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-2xl bg-navy-900 border border-slate-800 p-4">
                <div className="text-[11px] text-slate-400">Total Connected Handles</div>
                <div className="text-2xl font-extrabold text-white font-mono tabular-nums mt-1">
                  {socialStats.totalAccounts}
                </div>
                <div className="text-[11px] text-emerald-400 mt-1">
                  {socialStats.verifiedAccounts} Verified
                </div>
              </div>

              <div className="rounded-2xl bg-navy-900 border border-slate-800 p-4">
                <div className="text-[11px] text-slate-400">Social Tips Transferred</div>
                <div className="text-2xl font-extrabold text-gold-400 font-mono tabular-nums mt-1">
                  {socialStats.totalTransfers}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">Across X & Telegram</div>
              </div>

              <div className="rounded-2xl bg-navy-900 border border-slate-800 p-4">
                <div className="text-[11px] text-slate-400">Volume Transferred</div>
                <div className="text-2xl font-extrabold text-white font-mono tabular-nums mt-1">
                  {formatNim(socialStats.totalVolumeNim)}
                </div>
                <div className="text-[11px] text-slate-400 mt-1">NIM Settled on Ledger</div>
              </div>

              <div className="rounded-2xl bg-navy-900 border border-slate-800 p-4">
                <div className="text-[11px] text-slate-400">X Account Status</div>
                <div className="text-sm font-extrabold text-emerald-400 font-mono mt-2 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>@nimorapay Active</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1">
                  {socialBotConfig.twitterCookies ? 'Cookies Loaded' : 'Awaiting Cookies'}
                </div>
              </div>
            </div>

            {/* 2-Column Grid: X Account Cookies & Telegram Bot Config */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: X (@nimorapay) Account Cookies & Bot Engine */}
              <form
                onSubmit={handleSaveSocialConfig}
                className="lg:col-span-7 rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-5 shadow-xl"
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-black border border-slate-700 flex items-center justify-center text-white font-bold text-base">
                      𝕏
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white font-display">
                        @nimorapay X Account Cookies & Bot Config
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Configure cookies and Gemini AI processing for automated X tipping
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-gold-500/20 border border-gold-500/40 text-gold-400 font-semibold text-xs">
                    Official Bot
                  </span>
                </div>

                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      X Account Cookies (auth_token, ct0, or full cookies string)
                    </label>
                    <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
                      Paste the authentication cookies for the <strong>@nimorapay</strong> account on X here. The bot uses these cookies to monitor mentions ending with <code>@nimorapay &lt;amount&gt;</code> and reply automatically.
                    </p>
                    <textarea
                      rows={5}
                      value={twitterCookiesInput}
                      onChange={(e) => {
                        setTwitterCookiesInput(e.target.value);
                        setSocialFormDirty(true);
                      }}
                      placeholder={`auth_token=a1b2c3d4e5...; ct0=f6g7h8...; or {"auth_token":"...","ct0":"..."}`}
                      className="w-full p-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-gold-500 leading-relaxed"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div className="p-3.5 rounded-xl bg-navy-950 border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-200">Live Mentions Listener</div>
                        <div className="text-[11px] text-slate-400">
                          {socialBotConfig.isListening ? 'Polling X mentions actively' : 'Paused'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setSocialBotConfig((prev) => ({
                            ...prev,
                            isListening: !prev.isListening,
                          }))
                        }
                        className={`p-1.5 rounded-lg border text-xs font-bold transition-colors ${
                          socialBotConfig.isListening
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}
                      >
                        {socialBotConfig.isListening ? 'ENABLED' : 'DISABLED'}
                      </button>
                    </div>

                    <div className="p-3.5 rounded-xl bg-navy-950 border border-slate-800 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-200">Gemini AI Dynamic Reply</div>
                        <div className="text-[11px] text-slate-400">
                          {socialBotConfig.autoReply ? 'Vary responses each time' : 'Static template'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setSocialBotConfig((prev) => ({
                            ...prev,
                            autoReply: !prev.autoReply,
                          }))
                        }
                        className={`p-1.5 rounded-lg border text-xs font-bold transition-colors ${
                          socialBotConfig.autoReply
                            ? 'bg-gold-500/20 border-gold-500/40 text-gold-400'
                            : 'bg-slate-800 border-slate-700 text-slate-400'
                        }`}
                      >
                        {socialBotConfig.autoReply ? 'AI DYNAMIC' : 'STANDARD'}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={savingSocialConfig}
                    className="w-full min-h-[44px] rounded-xl bg-gold-500 hover:bg-gold-400 text-navy-950 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-gold-500/10"
                  >
                    <Key className="w-4 h-4" />
                    <span>{savingSocialConfig ? 'Saving Configurations…' : 'Save @nimorapay Cookies & Bot Config'}</span>
                  </button>
                </div>
              </form>

              {/* Right Column: Telegram Bot & Webhook Settings */}
              <div className="lg:col-span-5 rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-5 shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400 font-bold text-base">
                      <Send className="w-4 h-4 -rotate-45" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white font-display">
                        Telegram Bot Settings
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        @nimorapay_bot configuration & commands
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-full bg-sky-500/20 border border-sky-500/40 text-sky-400 font-semibold text-xs">
                    Telegram
                  </span>
                </div>

                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 mb-1">
                      Telegram Bot Token
                    </label>
                    <input
                      type="text"
                      value={telegramBotTokenInput}
                      onChange={(e) => {
                        setTelegramBotTokenInput(e.target.value);
                        setSocialFormDirty(true);
                      }}
                      placeholder="8834505856:AAFzOkTpf7MXL3CbqwzR-E-y61n4N20hOuw"
                      className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-sky-400"
                    />
                  </div>

                  <div className="p-3.5 rounded-xl bg-navy-950 border border-slate-800 space-y-2">
                    <div className="font-semibold text-slate-200 flex items-center gap-1.5">
                      <Bot className="w-4 h-4 text-sky-400" />
                      <span>Supported Commands:</span>
                    </div>
                    <div className="space-y-1 font-mono text-[11px] text-slate-300">
                      <div><strong className="text-sky-400">/connect &lt;code&gt;</strong> - Link Telegram handle to wallet</div>
                      <div><strong className="text-sky-400">/pay @recipient &lt;amount&gt;</strong> - Instant NIM transfer</div>
                      <div><strong className="text-sky-400">/balance</strong> - Check connected wallet address</div>
                      <div><strong className="text-sky-400">/help</strong> - Display instructions</div>
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl bg-navy-950 border border-slate-800 space-y-1 text-slate-400 text-[11px]">
                    <div className="font-semibold text-slate-200">Webhook Receiver URL</div>
                    <div className="font-mono text-slate-300 break-all select-all">
                      {window.location.origin}/api/social/telegram/webhook
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveSocialConfig}
                    disabled={savingSocialConfig}
                    className="w-full min-h-[44px] rounded-xl bg-sky-500 hover:bg-sky-400 text-navy-950 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-sky-500/10"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Save Telegram Settings</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Connected Social Accounts Table */}
            <div className="rounded-2xl bg-navy-900 border border-slate-800 overflow-hidden shadow-xl">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white font-display">
                    Connected Social Accounts ({socialAccounts.length})
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Users with verified X and Telegram handles mapped to Nimiq wallets
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-navy-950 text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="p-3.5">Platform</th>
                      <th className="p-3.5">Handle</th>
                      <th className="p-3.5">Wallet / User ID</th>
                      <th className="p-3.5">Verification Code</th>
                      <th className="p-3.5">Status</th>
                      <th className="p-3.5">Connected At</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {socialAccounts.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-6 text-center text-slate-400">
                          No connected social accounts yet.
                        </td>
                      </tr>
                    ) : (
                      socialAccounts.map((acc) => (
                        <tr key={acc.id} className="hover:bg-navy-950/40">
                          <td className="p-3.5 font-bold">
                            {acc.platform === 'TWITTER' ? (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-black border border-slate-700 text-white font-mono text-[11px]">
                                <span>𝕏</span> Twitter
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-sky-500/20 border border-sky-500/40 text-sky-400 font-mono text-[11px]">
                                <Send className="w-3 h-3 -rotate-45" /> Telegram
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 font-mono font-bold text-white">
                            {acc.displayHandle}
                          </td>
                          <td className="p-3.5 font-mono text-slate-300">
                            {acc.userId}
                          </td>
                          <td className="p-3.5 font-mono text-gold-400">
                            {acc.verificationCode}
                          </td>
                          <td className="p-3.5">
                            {acc.isVerified ? (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-semibold text-[11px]">
                                VERIFIED
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 text-amber-400 font-semibold text-[11px]">
                                PENDING CODE
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 text-slate-400">
                            {acc.verifiedAt
                              ? new Date(acc.verifiedAt).toLocaleString()
                              : 'Pending'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Live Social Media Transfers Feed */}
            <div className="rounded-2xl bg-navy-900 border border-slate-800 overflow-hidden shadow-xl">
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-white font-display">
                    Social Transfer Logs & AI Bot Replies ({socialTransfers.length})
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Real-time tips, giveaways, and bot automated responses
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-navy-950 text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-800">
                    <tr>
                      <th className="p-3.5">Time</th>
                      <th className="p-3.5">Platform</th>
                      <th className="p-3.5">Sender</th>
                      <th className="p-3.5">Recipient</th>
                      <th className="p-3.5">Amount</th>
                      <th className="p-3.5">Status</th>
                      <th className="p-3.5">Bot Response</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {socialTransfers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-400">
                          No social transfers logged yet. Test in Profile &gt; Settings &gt; Social!
                        </td>
                      </tr>
                    ) : (
                      socialTransfers.map((tx) => (
                        <tr key={tx.id} className="hover:bg-navy-950/40">
                          <td className="p-3.5 text-slate-400 whitespace-nowrap">
                            {new Date(tx.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="p-3.5 font-bold">
                            {tx.platform === 'TWITTER' ? '𝕏' : 'Telegram'}
                          </td>
                          <td className="p-3.5 font-mono text-slate-300">
                            @{tx.senderHandle}
                          </td>
                          <td className="p-3.5 font-mono text-slate-300">
                            @{tx.recipientHandle}
                          </td>
                          <td className="p-3.5 font-mono font-bold text-gold-400">
                            {formatNim(tx.amountNim)}
                          </td>
                          <td className="p-3.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                tx.status === 'SUCCESS'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-red-500/20 text-red-400 border border-red-500/30'
                              }`}
                            >
                              {tx.status}
                            </span>
                          </td>
                          <td className="p-3.5 text-slate-200 max-w-xs truncate" title={tx.botResponse}>
                            "{tx.botResponse}"
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB: CASHBACK & ESCROW MANAGEMENT (Admin Activation, Escrow Deposit, Fraud Check & Auto-Payout) */}
        {activeTab === 'CASHBACK' && (
          <div className="space-y-6">
            {/* Feedback & Success Banner */}
            {cashbackSuccessMessage && (
              <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center justify-between text-xs text-emerald-400 animate-fadeIn">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-400" />
                  <span>{cashbackSuccessMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCashbackSuccessMessage(null)}
                  className="p-1 rounded text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Top 4 Metric & Control Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Feature Status & Activation Toggle */}
              <div className="rounded-2xl bg-navy-900 border border-slate-800 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Cashback Feature</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      cashbackConfig.isActive
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}
                  >
                    {cashbackConfig.isActive ? 'ACTIVE' : 'DEACTIVATED'}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <div className="text-xl font-bold font-display text-white">
                      {cashbackConfig.isActive ? 'Feature Live' : 'Feature Off'}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Requires escrow deposit to run
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={savingCashbackConfig}
                    onClick={handleToggleCashbackActive}
                    className={`p-2 rounded-xl transition-all ${
                      cashbackConfig.isActive
                        ? 'bg-emerald-500 text-navy-950 hover:bg-emerald-400'
                        : 'bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700'
                    }`}
                    title={cashbackConfig.isActive ? 'Click to deactivate' : 'Click to activate'}
                  >
                    {cashbackConfig.isActive ? (
                      <ToggleRight className="w-6 h-6" />
                    ) : (
                      <ToggleLeft className="w-6 h-6" />
                    )}
                  </button>
                </div>
              </div>

              {/* Card 2: Escrow Wallet Balance */}
              <div className="rounded-2xl bg-navy-900 border border-slate-800 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Escrow Wallet Pool</span>
                  <Wallet className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <div className="text-xl font-bold font-mono text-gold-400">
                    {formatNim(cashbackConfig.escrowBalanceNim)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5 font-mono truncate" title={cashbackConfig.escrowWalletAddress}>
                    {shortenAddress(cashbackConfig.escrowWalletAddress)}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEscrowDepositModalOpen(true)}
                  className="w-full py-2 rounded-xl text-xs font-bold bg-navy-950 border border-slate-700 text-amber-400 hover:bg-amber-500/10 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Coins className="w-3.5 h-3.5" />
                  <span>Deposit Escrow Funds</span>
                </button>
              </div>

              {/* Card 3: Pending Anti-Fraud Claims */}
              <div className="rounded-2xl bg-navy-900 border border-slate-800 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Pending Claims</span>
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <div className="text-xl font-bold font-display text-white flex items-center gap-2">
                    <span>{cashbackStats.pendingClaimsCount}</span>
                    {cashbackStats.pendingClaimsCount > 0 && (
                      <span className="text-xs font-normal text-rose-400">awaiting check</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {formatNim(cashbackStats.pendingClaimsTotalNim)} in rewards
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">
                  Manual admin check prevents fraudulent circular transfers.
                </div>
              </div>

              {/* Card 4: Total Rewards Paid Out */}
              <div className="rounded-2xl bg-navy-900 border border-slate-800 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-400">Total Paid Out</span>
                  <CheckCheck className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-xl font-bold font-mono text-emerald-400">
                    {formatNim(cashbackConfig.totalPaidOutNim)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    {cashbackStats.confirmedClaimsCount} successful claims paid
                  </div>
                </div>
                <div className="text-[11px] text-slate-400">
                  Transferred automatically to user wallets from escrow.
                </div>
              </div>
            </div>

            {/* Config & Rule Thresholds Section */}
            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-white font-display flex items-center gap-2">
                    <BadgePercent className="w-5 h-5 text-amber-400" />
                    <span>Cashback Promotion Rules & Configuration</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Defines minimum transaction threshold, random reward ranges, and eligible channels.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">
                    Last updated: {new Date(cashbackConfig.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {/* Channel badges */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <ArrowUpRight className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">1. P2P Sales Orders</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Seller sells ≥ 5,000 $NIM in P2P order
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400">
                    <AtSign className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">2. Social Tips</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Twitter @nimorapay tips & Telegram /pay ≥ 5,000 $NIM
                    </div>
                  </div>
                </div>

                <div className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-rose-500/10 text-rose-400">
                    <Gift className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white">3. Red Packets</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Creator funds Red Packet ≥ 5,000 $NIM
                    </div>
                  </div>
                </div>
              </div>

              {/* Configuration Form */}
              <form onSubmit={handleSaveCashbackThresholds} className="pt-2 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Min Tx Required (NIM)
                  </label>
                  <input
                    type="number"
                    value={cbMinTxInput}
                    onChange={(e) => {
                      setCbMinTxInput(e.target.value);
                      setCbFormDirty(true);
                    }}
                    className="w-full bg-navy-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-500">Custom threshold: e.g. 1500 NIM</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Min Random Reward (NIM)
                  </label>
                  <input
                    type="number"
                    value={cbMinCashbackInput}
                    onChange={(e) => {
                      setCbMinCashbackInput(e.target.value);
                      setCbFormDirty(true);
                    }}
                    className="w-full bg-navy-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-500">Default: 200 NIM</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1">
                    Max Random Reward (NIM)
                  </label>
                  <input
                    type="number"
                    value={cbMaxCashbackInput}
                    onChange={(e) => {
                      setCbMaxCashbackInput(e.target.value);
                      setCbFormDirty(true);
                    }}
                    className="w-full bg-navy-950 border border-slate-700 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-gold-500 font-mono"
                  />
                  <span className="text-[10px] text-slate-500">Default: 5,000 NIM</span>
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={savingCashbackConfig}
                    className="w-full min-h-[42px] px-4 rounded-xl text-xs font-bold bg-gold-500 text-navy-950 hover:bg-gold-400 transition-colors flex items-center justify-center gap-2"
                  >
                    {savingCashbackConfig ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Check className="w-4 h-4" />
                    )}
                    <span>Save Thresholds</span>
                  </button>
                </div>
              </form>
            </div>

            {/* PENDING CLAIMS ANTI-FRAUD QUEUE */}
            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-white font-display flex items-center gap-2">
                    <ShieldAlert className="w-5 h-5 text-rose-400" />
                    <span>Manual Anti-Fraud Check & Confirmation Queue</span>
                    {cashbackClaims.filter((c) => c.status === 'PENDING').length > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                        {cashbackClaims.filter((c) => c.status === 'PENDING').length} awaiting check
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Admin checks for suspicious activity. If no suspicious activity is found, click{' '}
                    <span className="text-emerald-400 font-bold">Confirm & Pay</span> to automatically release cashback funds from the escrow wallet to the user.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => fetchOverview()}
                  className="px-3 py-1.5 rounded-lg bg-navy-950 border border-slate-700 text-slate-300 hover:text-white text-xs flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Refresh Queue</span>
                </button>
              </div>

              {cashbackClaims.filter((c) => c.status === 'PENDING').length === 0 ? (
                <div className="rounded-xl bg-navy-950/60 border border-slate-800/80 p-8 text-center text-slate-400 text-xs">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2 opacity-60" />
                  <div className="font-semibold text-slate-300">All Pending Claims Cleared</div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    No pending cashback rewards awaiting review. Eligible transactions of 5,000+ NIM will appear here automatically.
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {cashbackClaims
                    .filter((c) => c.status === 'PENDING')
                    .map((claim) => (
                      <div
                        key={claim.id}
                        className="rounded-2xl bg-navy-950 border border-slate-800 p-5 space-y-4 hover:border-slate-700 transition-colors shadow-lg"
                      >
                        {/* Claim Header */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-gold-500/10 text-gold-400 flex items-center justify-center font-bold text-xs">
                              {claim.userName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="text-sm font-bold text-white flex items-center gap-2">
                                <span>{claim.userName}</span>
                                <span className="text-xs font-mono text-slate-400 font-normal">
                                  ({shortenAddress(claim.userAddress)})
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-400">
                                Claim ID: <span className="font-mono text-slate-300">{claim.id}</span> ·{' '}
                                {new Date(claim.createdAt).toLocaleString()}
                              </div>
                            </div>
                          </div>

                          {/* Tx Type Badge */}
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
                                claim.txType === 'P2P_SELL_ORDER'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : claim.txType === 'TIP_TRANSACTION'
                                  ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              }`}
                            >
                              {claim.txType === 'P2P_SELL_ORDER' && <ArrowUpRight className="w-3.5 h-3.5" />}
                              {claim.txType === 'TIP_TRANSACTION' && <AtSign className="w-3.5 h-3.5" />}
                              {claim.txType === 'RED_PACKET' && <Gift className="w-3.5 h-3.5" />}
                              <span>
                                {claim.txType === 'P2P_SELL_ORDER'
                                  ? 'P2P Sales Order'
                                  : claim.txType === 'TIP_TRANSACTION'
                                  ? 'Social Tip'
                                  : 'Red Packet Deposit'}
                              </span>
                            </span>
                          </div>
                        </div>

                        {/* Details Grid & Fraud Assessment */}
                        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                          {/* Financials (5 cols) */}
                          <div className="md:col-span-5 grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-navy-900 border border-slate-800">
                            <div>
                              <div className="text-[10px] text-slate-400 uppercase font-semibold">
                                Original Tx Amount
                              </div>
                              <div className="text-sm font-mono font-bold text-white mt-0.5">
                                {formatNim(claim.txAmountNim)}
                              </div>
                              <div className="text-[10px] text-slate-500 truncate" title={claim.txReferenceId}>
                                Ref: {claim.txReferenceId}
                              </div>
                            </div>

                            <div>
                              <div className="text-[10px] text-gold-400 uppercase font-semibold">
                                Cashback Reward
                              </div>
                              <div className="text-base font-mono font-extrabold text-gold-400 mt-0.5">
                                +{formatNim(claim.cashbackAmountNim)}
                              </div>
                              <div className="text-[10px] text-emerald-400">
                                Direct wallet payout
                              </div>
                            </div>
                          </div>

                          {/* Fraud Risk Indicator (4 cols) */}
                          <div className="md:col-span-4 p-3.5 rounded-xl bg-navy-900 border border-slate-800 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-slate-400 uppercase font-semibold">
                                Anti-Fraud Risk
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  claim.fraudRiskScore <= 30
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : claim.fraudRiskScore <= 60
                                    ? 'bg-amber-500/20 text-amber-400'
                                    : 'bg-rose-500/20 text-rose-400'
                                }`}
                              >
                                {claim.fraudRiskScore <= 30
                                  ? 'LOW RISK'
                                  : claim.fraudRiskScore <= 60
                                  ? 'MODERATE RISK'
                                  : 'HIGH RISK'} ({claim.fraudRiskScore}/100)
                              </span>
                            </div>
                            <div className="space-y-1">
                              {claim.fraudReasons.map((reason, idx) => (
                                <div key={idx} className="text-[11px] text-slate-300 flex items-center gap-1.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                                  <span className="truncate">{reason}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Actions (3 cols) */}
                          <div className="md:col-span-3 flex flex-col gap-2">
                            <button
                              type="button"
                              disabled={processingClaimId === claim.id}
                              onClick={() => handleConfirmCashbackClaim(claim)}
                              className="w-full min-h-[42px] px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-navy-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-md"
                            >
                              {processingClaimId === claim.id ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4" />
                              )}
                              <span>Confirm & Auto-Pay</span>
                            </button>

                            <button
                              type="button"
                              disabled={processingClaimId === claim.id}
                              onClick={() => setRejectingClaimId(claim.id)}
                              className="w-full py-2 rounded-xl bg-navy-900 hover:bg-rose-500/10 text-rose-400 hover:text-rose-300 border border-rose-500/30 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                            >
                              <X className="w-3.5 h-3.5" />
                              <span>Reject Claim</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* ALL CLAIMS & AUDIT HISTORY TABLE */}
            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-base font-bold text-white font-display">
                    Cashback Claims History ({cashbackClaims.length})
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Complete audit trail of pending, paid, and rejected rewards.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {(['ALL', 'PENDING', 'CONFIRMED', 'REJECTED'] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setCashbackStatusFilter(filter)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                        cashbackStatusFilter === filter
                          ? 'bg-gold-500 text-navy-950'
                          : 'bg-navy-950 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 font-semibold bg-navy-950/60">
                      <th className="p-3">Created</th>
                      <th className="p-3">User & Wallet</th>
                      <th className="p-3">Channel</th>
                      <th className="p-3">Tx Amount</th>
                      <th className="p-3">Reward</th>
                      <th className="p-3">Risk</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Payout TxHash / Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-medium">
                    {cashbackClaims
                      .filter(
                        (c) =>
                          cashbackStatusFilter === 'ALL' || c.status === cashbackStatusFilter
                      )
                      .map((claim) => (
                        <tr key={claim.id} className="hover:bg-navy-950/40">
                          <td className="p-3 text-slate-400 whitespace-nowrap">
                            {new Date(claim.createdAt).toLocaleDateString([], {
                              month: 'short',
                              day: 'numeric',
                            })}{' '}
                            <span className="text-[10px] text-slate-500">
                              {new Date(claim.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </td>
                          <td className="p-3">
                            <div className="font-bold text-white">{claim.userName}</div>
                            <div className="font-mono text-[11px] text-slate-400 truncate max-w-[140px]" title={claim.userAddress}>
                              {shortenAddress(claim.userAddress)}
                            </div>
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                claim.txType === 'P2P_SELL_ORDER'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : claim.txType === 'TIP_TRANSACTION'
                                  ? 'bg-sky-500/10 text-sky-400'
                                  : 'bg-rose-500/10 text-rose-400'
                              }`}
                            >
                              {claim.txType === 'P2P_SELL_ORDER'
                                ? 'P2P Sell'
                                : claim.txType === 'TIP_TRANSACTION'
                                ? 'Social Tip'
                                : 'Red Packet'}
                            </span>
                          </td>
                          <td className="p-3 font-mono font-bold text-slate-200">
                            {formatNim(claim.txAmountNim)}
                          </td>
                          <td className="p-3 font-mono font-extrabold text-gold-400">
                            +{formatNim(claim.cashbackAmountNim)}
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                claim.fraudRiskScore <= 30
                                  ? 'text-emerald-400'
                                  : claim.fraudRiskScore <= 60
                                  ? 'text-amber-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {claim.fraudRiskScore}
                            </span>
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                claim.status === 'CONFIRMED'
                                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                  : claim.status === 'PENDING'
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              }`}
                            >
                              {claim.status === 'CONFIRMED'
                                ? 'PAID'
                                : claim.status === 'PENDING'
                                ? 'PENDING'
                                : 'REJECTED'}
                            </span>
                          </td>
                          <td className="p-3 max-w-xs truncate text-[11px] text-slate-300">
                            {claim.txHash ? (
                              <div className="font-mono text-emerald-400 truncate" title={claim.txHash}>
                                tx: {claim.txHash.slice(0, 16)}…
                              </div>
                            ) : claim.adminNotes ? (
                              <div className="text-slate-400 truncate" title={claim.adminNotes}>
                                {claim.adminNotes}
                              </div>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL: ESCROW WALLET DEPOSIT */}
      {escrowDepositModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-navy-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <Coins className="w-5 h-5" />
                <span>Deposit into Cashback Escrow Wallet</span>
              </div>
              <button
                type="button"
                onClick={() => setEscrowDepositModalOpen(false)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 space-y-1">
                <div className="text-slate-400 font-semibold">Platform Escrow Address</div>
                <div className="font-mono text-xs text-gold-400 break-all">
                  {cashbackConfig.escrowWalletAddress}
                </div>
                <div className="text-[10px] text-slate-500 pt-1">
                  Cashback payouts are automatically transferred from this balance when the admin clicks Confirm.
                </div>
              </div>

              <form onSubmit={handleDepositCashbackEscrow} className="space-y-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Deposit Amount ($NIM)
                  </label>
                  <input
                    type="number"
                    required
                    min="100"
                    step="100"
                    value={depositAmountInput}
                    onChange={(e) => setDepositAmountInput(e.target.value)}
                    placeholder="e.g. 25000"
                    className="w-full bg-navy-950 border border-slate-700 rounded-xl px-3 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-gold-500"
                  />
                  {/* Preset buttons */}
                  <div className="flex gap-2 mt-2">
                    {['10000', '25000', '50000', '100000'].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setDepositAmountInput(preset)}
                        className="px-2.5 py-1 rounded bg-navy-950 border border-slate-800 text-[10px] text-slate-300 hover:text-gold-400 font-mono"
                      >
                        +{Number(preset).toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Transaction Hash / Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={depositTxHashInput}
                    onChange={(e) => setDepositTxHashInput(e.target.value)}
                    placeholder="Optional on-chain hash or internal reference"
                    className="w-full bg-navy-950 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-gold-500"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEscrowDepositModalOpen(false)}
                    className="flex-1 py-2.5 rounded-xl bg-navy-950 border border-slate-700 text-slate-300 font-bold hover:bg-navy-900"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={depositingEscrow}
                    className="flex-1 py-2.5 rounded-xl bg-gold-500 text-navy-950 font-bold hover:bg-gold-400 flex items-center justify-center gap-2"
                  >
                    {depositingEscrow ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Coins className="w-4 h-4" />
                    )}
                    <span>Confirm Deposit</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: REJECT CLAIM REASON */}
      {rejectingClaimId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-navy-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                <AlertTriangle className="w-5 h-5" />
                <span>Reject Cashback Claim</span>
              </div>
              <button
                type="button"
                onClick={() => setRejectingClaimId(null)}
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-300">
              Provide a reason for rejecting this claim. This will be recorded in the audit logs.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Rejection Note / Reason
              </label>
              <textarea
                rows={3}
                value={rejectReasonInput}
                onChange={(e) => setRejectReasonInput(e.target.value)}
                className="w-full bg-navy-950 border border-slate-700 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-rose-500"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setRejectingClaimId(null)}
                className="flex-1 py-2.5 rounded-xl bg-navy-950 border border-slate-700 text-slate-300 font-bold hover:bg-navy-900"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={processingClaimId === rejectingClaimId}
                onClick={handleRejectCashbackClaim}
                className="flex-1 py-2.5 rounded-xl bg-rose-500 text-white font-bold hover:bg-rose-600 flex items-center justify-center gap-2"
              >
                {processingClaimId === rejectingClaimId ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <X className="w-4 h-4" />
                )}
                <span>Confirm Rejection</span>
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Admin Red Packet Wallet Funding Confirmation Sheet */}
      {pendingAdminRp && (
        <SendConfirmationSheet
          open={true}
          title="Fund Official Admin Red Packet"
          recipientAddress={pendingAdminRp.escrowAddress}
          recipientLabel="Nimora Red Packet Escrow"
          amountNim={pendingAdminRp.packet.totalNim}
          referenceId={`packet:${pendingAdminRp.packet.id}`}
          loading={creatingRp}
          onConfirm={handleAdminConfirmRedPacketDeposit}
          onCancel={() => setPendingAdminRp(null)}
        />
      )}

      {/* Modal: Inspect & Arbitrate Order */}
      {inspectOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-navy-900 border border-slate-800 rounded-3xl p-6 w-full max-w-lg space-y-5 shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-mono text-gold-400">
                  ESCROW ARBITRATION & ORDER INSPECTOR
                </div>
                <h3 className="text-lg font-bold text-white font-display">
                  Order {inspectOrder.id} ({inspectOrder.status})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectOrder(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl bg-navy-950 border border-slate-800 p-4 space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Escrow Amount</span>
                <span className="font-mono font-bold text-gold-400">
                  {formatNim(inspectOrder.amountNim)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Fiat Settlement</span>
                <span className="font-mono font-bold text-white">
                  {formatFiat(inspectOrder.fiatAmount, inspectOrder.fiatCurrency)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Seller</span>
                <span className="text-white font-medium">
                  {inspectOrder.sellerName} ({shortenAddress(inspectOrder.sellerAddress)})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Buyer</span>
                <span className="text-white font-medium">
                  {inspectOrder.buyerName} ({shortenAddress(inspectOrder.buyerAddress)})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Payment Rail</span>
                <span className="text-slate-200">
                  {inspectOrder.selectedPaymentMethod.providerName} ·{' '}
                  {inspectOrder.selectedPaymentMethod.accountNumberMasked}
                </span>
              </div>
              {inspectOrder.depositTxHash && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Deposit TxHash</span>
                  <span className="font-mono text-emerald-400">
                    {shortenAddress(inspectOrder.depositTxHash)}
                  </span>
                </div>
              )}
            </div>

            {inspectOrder.proofNote && (
              <div className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 text-xs space-y-2">
                <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                  <FileCheck2 className="w-4 h-4" />
                  <span>Buyer Submitted Payment Proof</span>
                </div>
                <div className="text-slate-300">Note: {inspectOrder.proofNote}</div>
                {inspectOrder.proofImageUrl && (
                  <img
                    src={inspectOrder.proofImageUrl}
                    alt="Receipt proof"
                    className="max-h-48 rounded-lg border border-slate-800 object-contain"
                  />
                )}
              </div>
            )}

            {![
              'RELEASED',
              'CANCELLED_BUYER',
              'CANCELLED_TIMEOUT',
              'REFUNDED',
            ].includes(inspectOrder.status) && (
              <div className="pt-2 border-t border-slate-800 space-y-2.5">
                <div className="text-xs font-bold text-slate-300">
                  Execute Platform Escrow Arbitration:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={actionBusy === inspectOrder.id}
                    onClick={() =>
                      handleResolveOrder(inspectOrder.id, 'RELEASE_TO_BUYER')
                    }
                    className="min-h-[44px] rounded-xl bg-emerald-500 text-navy-950 font-bold text-xs hover:brightness-105"
                  >
                    Release NIM to Buyer
                  </button>
                  <button
                    type="button"
                    disabled={actionBusy === inspectOrder.id}
                    onClick={() =>
                      handleResolveOrder(inspectOrder.id, 'REFUND_TO_SELLER')
                    }
                    className="min-h-[44px] rounded-xl bg-amber-500 text-navy-950 font-bold text-xs hover:brightness-105"
                  >
                    Refund NIM to Seller
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
