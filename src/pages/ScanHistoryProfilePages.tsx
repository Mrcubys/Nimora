import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import jsQR from 'jsqr';
import {
  Camera,
  Upload,
  CheckCircle2,
  XCircle,
  Lock,
  Plus,
  Trash2,
  LogOut,
  Globe,
  Sun,
  Moon,
  Wallet,
  ShieldCheck,
  X,
  RefreshCw,
  Copy,
  ExternalLink,
  MessageSquare,
  Bot,
  Sparkles,
  Check,
  ArrowRight,
  Send,
  AtSign,
  Coins,
  BadgePercent,
  Gift,
  ArrowUpRight,
} from 'lucide-react';
import { useAppStore, apiFetch, UserProfile } from '../store/useAppStore.ts';
import { parseNimoraQR } from '../lib/qr/payload.ts';
import { sendNim } from '../lib/nimiq/sdk.ts';
import { formatNim, formatFiat, shortenAddress } from '../lib/nimiq/units.ts';
import {
  SUPPORTED_REGIONS,
  COUNTRY_LANGUAGE_MAP,
  P2POrderStatus,
  type SocialAccountItem,
  type SocialTransferItem,
  formatTwitterTemplate,
  formatTelegramCommand,
  type CashbackClaimItem,
} from '../../packages/shared/index.ts';
import { SendConfirmationSheet } from '../components/ui/CoreComponents.tsx';
import { AVAILABLE_LANGUAGES } from '../i18n/index.ts';

// ============================================================================
// 1. SCAN QR PAGE (/scan)
// ============================================================================
export const ScanQRPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { deductSimulatedBalance, syncWalletBalance } = useAppStore();
  const [manualInput, setManualInput] = useState('');
  const [cameraActive, setCameraActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawSendTarget, setRawSendTarget] = useState<{
    address: string;
    amountNim: number;
  } | null>(null);
  const [sending, setSending] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopCamera = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const handleDecodedString = (raw: string) => {
    setError(null);
    const parsed = parseNimoraQR(raw);
    if (parsed.type === 'REQUEST' && parsed.slug) {
      stopCamera();
      navigate(`/r/${parsed.slug}`);
      return;
    }
    if (parsed.type === 'REDPACKET' && parsed.slug) {
      stopCamera();
      navigate(`/rp/${parsed.slug}`);
      return;
    }
    if (parsed.type === 'RAW_ADDRESS' && parsed.address) {
      stopCamera();
      setRawSendTarget({
        address: parsed.address,
        amountNim: parsed.amountNim || 100,
      });
      return;
    }
    setError('Unrecognized QR code or Nimiq link.');
  };

  const scanVideoFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });
        if (code && code.data) {
          handleDecodedString(code.data);
          return;
        }
      }
    }
    rafRef.current = requestAnimationFrame(scanVideoFrame);
  };

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      setCameraActive(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute('playsinline', 'true');
          videoRef.current.play().catch(() => {});
          rafRef.current = requestAnimationFrame(scanVideoFrame);
        }
      }, 50);
    } catch {
      setCameraActive(false);
      setError(
        'Camera permission denied or unavailable. Use image upload or paste link below.'
      );
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setError('Could not process QR image.');
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);
        if (code && code.data) {
          handleDecodedString(code.data);
        } else {
          setError('Could not detect a valid QR code in that image.');
        }
      };
      img.onerror = () => setError('Invalid image file.');
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSendToRawAddress = async () => {
    if (!rawSendTarget) return;
    setSending(true);
    try {
      await sendNim({
        recipient: rawSendTarget.address,
        amountNim: rawSendTarget.amountNim,
        data: 'Nimora Direct Transfer',
      });
      deductSimulatedBalance(rawSendTarget.amountNim);
      setRawSendTarget(null);
      await syncWalletBalance();
      navigate('/history');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white font-display">
          {t('scan.title')}
        </h1>
        <p className="text-xs text-slate-400 mt-1">{t('scan.subtitle')}</p>
      </div>

      <div className="rounded-3xl bg-navy-900 border border-slate-800 p-6 space-y-4 shadow-xl">
        <div className="w-full min-h-[260px] rounded-2xl bg-navy-950 border border-slate-800 flex items-center justify-center overflow-hidden relative">
          {cameraActive ? (
            <>
              <video
                ref={videoRef}
                className="w-full h-64 object-cover"
                muted
                playsInline
              />
              <canvas ref={canvasRef} className="hidden" />
              <div className="absolute inset-0 pointer-events-none border-2 border-gold-400/50 rounded-2xl m-8" />
            </>
          ) : (
            <div className="text-center p-6 space-y-3">
              <Camera className="w-10 h-10 text-gold-400 mx-auto" />
              <div className="text-xs text-slate-400">
                {t('scan.subtitle')}
              </div>
              <button
                type="button"
                onClick={startCamera}
                className="min-h-[44px] px-5 rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-bold text-xs"
              >
                Start Camera Scanner
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3">
          <label className="flex-1 min-h-[44px] px-4 rounded-xl bg-navy-950 border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-200 flex items-center justify-center gap-2 cursor-pointer">
            <Upload className="w-4 h-4 text-gold-400" />
            <span>{t('scan.uploadQrImage')}</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
          {cameraActive && (
            <button
              type="button"
              onClick={stopCamera}
              className="min-h-[44px] px-4 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-200"
            >
              Stop Camera
            </button>
          )}
        </div>

        <div className="pt-4 border-t border-slate-800 space-y-2">
          <label className="block text-xs font-semibold text-slate-300">
            {t('scan.pastePlaceholder')}
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={manualInput}
              onChange={(e) => setManualInput(e.target.value)}
              placeholder="nimora://request?id=... or NQ47 JQ20..."
              className="flex-1 h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-gold-500"
            />
            <button
              type="button"
              onClick={() => handleDecodedString(manualInput)}
              className="min-h-[44px] px-4 rounded-xl bg-gold-500 text-navy-950 font-bold text-xs"
            >
              {t('scan.resolveBtn')}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl bg-red-950/50 border border-red-500/40 p-3 text-xs text-red-200">
            {error}
          </div>
        )}
      </div>

      {rawSendTarget && (
        <SendConfirmationSheet
          open={true}
          title="Direct Wallet Transfer"
          recipientAddress={rawSendTarget.address}
          recipientLabel="Direct Nimiq Wallet"
          amountNim={rawSendTarget.amountNim}
          referenceId="direct:transfer"
          loading={sending}
          onConfirm={handleSendToRawAddress}
          onCancel={() => setRawSendTarget(null)}
        />
      )}
    </div>
  );
};

// ============================================================================
// 2. UNIFIED ACTIVITY & HISTORY PAGE (/history)
// ============================================================================
interface HistoryData {
  p2pOrders: Array<{
    id: string;
    sellerId: string;
    sellerName: string;
    buyerId: string;
    buyerName: string;
    amountNim: number;
    fiatAmount: number;
    fiatCurrency: string;
    status: P2POrderStatus;
    cancelReason: string | null;
    depositTxHash: string | null;
    releaseTxHash: string | null;
    createdAt: string;
  }>;
  paymentRequests: Array<{
    id: string;
    creatorName: string;
    amountNim: number | null;
    note: string;
    status: string;
    paidTxHash: string | null;
    slug: string;
    createdAt: string;
  }>;
  redPacketsCreated: Array<{
    id: string;
    totalNim: number;
    slots: number;
    mode: string;
    status: string;
    slug: string;
    claimsCount: number;
    createdAt: string;
  }>;
  redPacketClaims: Array<{
    id: string;
    packetSlug: string;
    senderName: string;
    amountNim: number;
    payoutTxHash: string;
    createdAt: string;
  }>;
}

export const HistoryPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAppStore();
  const [data, setData] = useState<HistoryData | null>(null);
  const [filter, setFilter] = useState<
    'ALL' | 'P2P' | 'REQUESTS' | 'REDPACKETS' | 'CANCELLED'
  >('ALL');
  const [loading, setLoading] = useState(true);

  const locale = user?.locale || 'en';

  useEffect(() => {
    apiFetch<HistoryData>('/api/history')
      .then((res) => setData(res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="h-20 rounded-2xl bg-navy-900 border border-slate-800 animate-pulse"
          />
        ))}
      </div>
    );
  }

  const cancelledP2P = data.p2pOrders.filter((o) =>
    ['CANCELLED_TIMEOUT', 'CANCELLED_BUYER', 'REFUNDED'].includes(o.status)
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-xl font-bold text-white font-display">
          {t('history.title')}
        </h1>

        <div className="flex flex-wrap gap-1.5 bg-navy-900 p-1 rounded-xl border border-slate-800">
          {(
            [
              ['ALL', t('history.all')],
              ['P2P', t('history.p2p')],
              ['REQUESTS', t('history.requests')],
              ['REDPACKETS', t('history.redPackets')],
              ['CANCELLED', t('history.cancelled')],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors ${
                filter === key
                  ? 'bg-gold-500 text-navy-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* P2P Orders Section */}
      {(filter === 'ALL' || filter === 'P2P') && (
        <div className="space-y-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('history.p2pSectionTitle')} ({data.p2pOrders.length})
          </h2>
          {data.p2pOrders.length === 0 ? (
            <div className="rounded-xl bg-navy-900/50 border border-slate-800 p-4 text-xs text-slate-500">
              {t('history.noP2pTrades')}
            </div>
          ) : (
            data.p2pOrders.map((o) => {
              const isBuyer = o.buyerId === user?.id;
              return (
                <div
                  key={o.id}
                  onClick={() => navigate(`/p2p/orders/${o.id}`)}
                  className="cursor-pointer rounded-2xl bg-navy-900 hover:bg-navy-800/80 border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={`font-bold ${
                          isBuyer ? 'text-emerald-400' : 'text-gold-400'
                        }`}
                      >
                        {isBuyer ? t('home.buyingNim') : t('home.sellingNim')}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-slate-300">
                        {isBuyer ? o.sellerName : o.buyerName}
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="font-mono text-gold-400">{o.status}</span>
                    </div>
                    <div className="text-sm font-bold text-white font-mono tabular-nums mt-1">
                      {formatNim(o.amountNim, locale)} ↔{' '}
                      {formatFiat(o.fiatAmount, o.fiatCurrency, locale)}
                    </div>
                    {o.cancelReason && (
                      <div className="text-[11px] text-amber-300 mt-0.5">
                        Reason: {o.cancelReason}
                      </div>
                    )}
                  </div>
                  <div className="text-end text-[11px] font-mono text-slate-400">
                    {o.releaseTxHash && (
                      <div className="text-emerald-400">
                        Release Tx: {shortenAddress(o.releaseTxHash)}
                      </div>
                    )}
                    <div>{new Date(o.createdAt).toLocaleString(locale)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Cancelled & Expired Section */}
      {filter === 'CANCELLED' && (
        <div className="space-y-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-amber-400">
            {t('history.cancelledSectionTitle')} ({cancelledP2P.length})
          </h2>
          {cancelledP2P.length === 0 ? (
            <div className="rounded-xl bg-navy-900/50 border border-slate-800 p-4 text-xs text-slate-500">
              {t('history.noCancelledOrders')}
            </div>
          ) : (
            cancelledP2P.map((o) => (
              <div
                key={o.id}
                onClick={() => navigate(`/p2p/orders/${o.id}`)}
                className="cursor-pointer rounded-2xl bg-navy-900 border border-amber-500/30 p-4 flex items-center justify-between"
              >
                <div>
                  <div className="text-xs font-bold text-amber-300">
                    {o.status} · {o.cancelReason || 'EXPIRED'}
                  </div>
                  <div className="text-sm font-mono font-bold text-white mt-0.5">
                    {formatNim(o.amountNim, locale)} ({formatFiat(o.fiatAmount, o.fiatCurrency, locale)})
                  </div>
                </div>
                <XCircle className="w-5 h-5 text-amber-400" />
              </div>
            ))
          )}
        </div>
      )}

      {/* Payment Requests Section */}
      {(filter === 'ALL' || filter === 'REQUESTS') && (
        <div className="space-y-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('history.requestsSectionTitle')} ({data.paymentRequests.length})
          </h2>
          {data.paymentRequests.map((r) => (
            <div
              key={r.id}
              onClick={() => navigate(`/r/${r.slug}`)}
              className="cursor-pointer rounded-2xl bg-navy-900 border border-slate-800 p-4 flex items-center justify-between"
            >
              <div>
                <div className="text-xs font-bold text-white font-mono">
                  {r.amountNim ? formatNim(r.amountNim, locale) : t('request.openAmount')} ·{' '}
                  <span className="text-gold-400">{r.status}</span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {r.note || t('request.noNote')}
                </div>
              </div>
              {r.status === 'PAID' && (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Red Packets Section */}
      {(filter === 'ALL' || filter === 'REDPACKETS') && (
        <div className="space-y-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {t('history.redPacketsSectionTitle')} (
            {data.redPacketsCreated.length + data.redPacketClaims.length})
          </h2>
          {data.redPacketClaims.map((c) => (
            <div
              key={c.id}
              onClick={() => navigate(`/rp/${c.packetSlug}`)}
              className="cursor-pointer rounded-2xl bg-navy-900 border border-slate-800 p-4 flex items-center justify-between"
            >
              <div>
                <div className="text-xs text-emerald-400 font-semibold">
                  Claimed from {c.senderName}
                </div>
                <div className="text-sm font-mono font-bold text-gold-400">
                  +{formatNim(c.amountNim, locale)}
                </div>
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                Tx: {shortenAddress(c.payoutTxHash)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 3. PROFILE & ACCOUNT MANAGEMENT PAGE (/profile)
// ============================================================================
interface PaymentMethodItem {
  id: string;
  country: string;
  providerCode: string;
  providerName: string;
  type: 'BANK' | 'EWALLET';
  accountName: string;
  accountNumberMasked: string;
}

interface ProfileP2PAd {
  id: string;
  side: 'SELL_NIM' | 'BUY_NIM';
  country: string;
  fiatCurrency: string;
  priceMode: 'FIXED' | ' FLOATING';
  price: number;
  minAmountNim: number;
  maxAmountNim: number;
  availableNim: number;
  paymentMethodProviders: Array<{ code: string; name: string; type: string }>;
  status: 'ACTIVE' | 'PAUSED';
}

export const ProfilePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    user,
    walletBalanceNim,
    walletBalanceSynced,
    marketRates,
    theme,
    setTheme,
    setLocale,
    updateUser,
    syncWalletBalance,
    syncMarketRates,
    logout,
  } = useAppStore();

  const [activeSection, setActiveSection] = useState<
    'OVERVIEW' | 'ADS' | 'METHODS' | 'SETTINGS' | 'SOCIAL' | 'CASHBACK'
  >('OVERVIEW');
  const [settingsSubSection, setSettingsSubSection] = useState<'GENERAL' | 'SOCIAL'>('GENERAL');

  // Cashback Rewards State
  const [cashbackPromo, setCashbackPromo] = useState<{
    isActive: boolean;
    minTxAmountNim: number;
    minCashbackNim: number;
    maxCashbackNim: number;
  }>({
    isActive: false,
    minTxAmountNim: 5000,
    minCashbackNim: 200,
    maxCashbackNim: 5000,
  });
  const [myCashbackClaims, setMyCashbackClaims] = useState<CashbackClaimItem[]>([]);
  const [totalCashbackEarned, setTotalCashbackEarned] = useState(0);
  const [pendingCashbackTotal, setPendingCashbackTotal] = useState(0);

  // Social Accounts & Tipping state
  const [socialData, setSocialData] = useState<{
    twitter: SocialAccountItem | null;
    telegram: SocialAccountItem | null;
    demoPeers: Array<{ platform: string; handle: string; displayHandle: string }>;
  }>({ twitter: null, telegram: null, demoPeers: [] });
  const [socialTransfers, setSocialTransfers] = useState<SocialTransferItem[]>([]);
  const [twitterInput, setTwitterInput] = useState('');
  const [telegramInput, setTelegramInput] = useState('');
  const [twitterBusy, setTwitterBusy] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const [twitterCode, setTwitterCode] = useState<string | null>(null);
  const [twitterTemplate, setTwitterTemplate] = useState<string | null>(null);
  const [telegramCode, setTelegramCode] = useState<string | null>(null);
  const [telegramStarted, setTelegramStarted] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [socialMsg, setSocialMsg] = useState<string | null>(null);
  const [socialError, setSocialError] = useState<string | null>(null);

  // Simulator state
  const [simPlatform, setSimPlatform] = useState<'TWITTER' | 'TELEGRAM'>('TWITTER');
  const [simSender, setSimSender] = useState('');
  const [simText, setSimText] = useState(
    "Bro, you're awesome! I'm sending you a little something—not much, but here you go: @nimorapay 1000"
  );
  const [simBusy, setSimBusy] = useState(false);
  const [simResult, setSimResult] = useState<{
    success: boolean;
    status: string;
    botResponse: string;
    parsed?: any;
  } | null>(null);

  const [methods, setMethods] = useState<PaymentMethodItem[]>([]);
  const [myAds, setMyAds] = useState<ProfileP2PAd[]>([]);
  const [providerCode, setProviderCode] = useState('');
  const [accountName, setAccountName] = useState(user?.realName || '');
  const [accountNumber, setAccountNumber] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [adding, setAdding] = useState(false);
  const [syncingBalance, setSyncingBalance] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create Ad Modal (Hosted exclusively in Profile Menu)
  const [createAdOpen, setCreateAdOpen] = useState(false);
  const [newAdSide, setNewAdSide] = useState<'SELL_NIM' | 'BUY_NIM'>('SELL_NIM');
  const [newAdPrice, setNewAdPrice] = useState<string>('');
  const [newAdMin, setNewAdMin] = useState<string>('250');
  const [newAdMax, setNewAdMax] = useState<string>('25000');
  const [newAdAvail, setNewAdAvail] = useState<string>('50000');
  const [newAdPmIds, setNewAdPmIds] = useState<string[]>([]);
  const [postingAd, setPostingAd] = useState(false);

  const region = user?.country ? SUPPORTED_REGIONS[user.country] : SUPPORTED_REGIONS.ID;
  const locale = user?.locale || 'en';
  const defaultCountryLocale = user?.country
    ? COUNTRY_LANGUAGE_MAP[user.country] || region?.defaultLocale || 'en'
    : 'en';

  const currencyCode = region?.currency || 'USD';
  const liveMarketPrice =
    marketRates[currencyCode] ||
    marketRates[currencyCode.toUpperCase()] ||
    region?.defaultNimPriceFiat ||
    0.00138;

  const estimatedFiatBalance = walletBalanceNim * liveMarketPrice;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  };

  const loadProfileData = async () => {
    try {
      const [pmRes, adsRes, socRes, txRes, cbCfgRes, cbClaimsRes] = await Promise.all([
        apiFetch<{ paymentMethods: PaymentMethodItem[] }>('/api/payment-methods'),
        apiFetch<{ ads: ProfileP2PAd[] }>('/api/p2p/ads?mine=true'),
        apiFetch<{
          twitter: SocialAccountItem | null;
          telegram: SocialAccountItem | null;
          demoPeers: Array<{ platform: string; handle: string; displayHandle: string }>;
        }>('/api/social/accounts').catch(() => ({ twitter: null, telegram: null, demoPeers: [] })),
        apiFetch<{ transfers: SocialTransferItem[]; recentCommunity: SocialTransferItem[] }>('/api/social/transfers').catch(() => ({ transfers: [], recentCommunity: [] })),
        apiFetch<{ config: typeof cashbackPromo }>('/api/cashback/config').catch(() => null),
        apiFetch<{ claims: CashbackClaimItem[]; totalEarnedNim: number; pendingNim: number }>('/api/cashback/my-claims').catch(() => null),
      ]);
      setMethods(pmRes.paymentMethods);
      setMyAds(adsRes.ads);
      setSocialData(socRes);
      setSocialTransfers(txRes.transfers && txRes.transfers.length > 0 ? txRes.transfers : txRes.recentCommunity || []);

      if (cbCfgRes && cbCfgRes.config) {
        setCashbackPromo(cbCfgRes.config);
      }
      if (cbClaimsRes) {
        setMyCashbackClaims(cbClaimsRes.claims || []);
        setTotalCashbackEarned(cbClaimsRes.totalEarnedNim || 0);
        setPendingCashbackTotal(cbClaimsRes.pendingNim || 0);
      }

      if (socRes.twitter) {
        setTwitterInput(socRes.twitter.handle);
        if (socRes.twitter.isVerified) {
          if (twitterCode) {
            setSocialMsg('Your Twitter connection is successful.');
            setTwitterCode(null);
            setTwitterTemplate(null);
          }
        } else if (socRes.twitter.verificationCode) {
          setTwitterCode(socRes.twitter.verificationCode);
          setTwitterTemplate(formatTwitterTemplate(socRes.twitter.verificationCode));
        }
      }
      if (socRes.telegram) {
        setTelegramInput(socRes.telegram.handle);
        if (socRes.telegram.isVerified) {
          if (telegramCode) {
            setSocialMsg('Your Telegram connection is successful.');
            setTelegramCode(null);
            setTelegramStarted(false);
          }
        } else if (socRes.telegram.verificationCode) {
          setTelegramCode(socRes.telegram.verificationCode);
          setTelegramStarted(true);
        }
      }

      if (region && region.paymentMethods.length > 0 && !providerCode) {
        setProviderCode(region.paymentMethods[0].code);
      }
      if (!newAdPrice && liveMarketPrice) {
        setNewAdPrice(String(liveMarketPrice));
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    loadProfileData();
    syncWalletBalance();
    syncMarketRates();
    if (user?.realName) setAccountName(user.realName);
  }, [user?.realName]);

  // Real-time automatic polling when waiting for connection verification
  useEffect(() => {
    const isWaitingTwitter = Boolean(twitterCode && !socialData.twitter?.isVerified);
    const isWaitingTelegram = Boolean(telegramCode && !socialData.telegram?.isVerified);
    if (!isWaitingTwitter && !isWaitingTelegram) return;

    const timer = setInterval(() => {
      loadProfileData();
    }, 2000);

    return () => clearInterval(timer);
  }, [twitterCode, telegramCode, socialData.twitter?.isVerified, socialData.telegram?.isVerified]);

  const handleManualRefreshWallet = async () => {
    setSyncingBalance(true);
    try {
      await Promise.all([syncWalletBalance(), syncMarketRates()]);
    } finally {
      setSyncingBalance(false);
    }
  };

  const selectedProviderDef = region?.paymentMethods.find(
    (p) => p.code === providerCode
  );

  const handleAddPaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await apiFetch('/api/payment-methods', {
        method: 'POST',
        body: JSON.stringify({
          providerCode,
          accountName,
          accountNumber,
          extraFields: routingNumber ? { routingNumber } : {},
        }),
      });
      setAccountNumber('');
      setRoutingNumber('');
      await loadProfileData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add payment method');
    } finally {
      setAdding(false);
    }
  };

  const handleCreateAd = async (e: React.FormEvent) => {
    e.preventDefault();
    setPostingAd(true);
    setError(null);
    try {
      await apiFetch('/api/p2p/ads', {
        method: 'POST',
        body: JSON.stringify({
          side: newAdSide,
          priceMode: 'FIXED',
          price: Number(newAdPrice),
          minAmountNim: Number(newAdMin),
          maxAmountNim: Number(newAdMax),
          availableNim: Number(newAdAvail),
          paymentMethodIds: newAdPmIds,
        }),
      });
      setCreateAdOpen(false);
      await loadProfileData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post advertisement');
    } finally {
      setPostingAd(false);
    }
  };

  const handleLanguageChange = async (newLocale: string) => {
    setLocale(newLocale);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/users/me/settings', {
        method: 'PATCH',
        body: JSON.stringify({ locale: newLocale }),
      });
      updateUser(res.user);
    } catch {
      // Ignore
    }
  };

  const handleTwitterConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setTwitterBusy(true);
    setSocialError(null);
    setSocialMsg(null);
    try {
      const res = await apiFetch<{
        verificationCode: string;
        twitterTemplate: string;
      }>('/api/social/connect', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'TWITTER',
          handle: twitterInput,
        }),
      });
      setTwitterCode(res.verificationCode);
      setTwitterTemplate(res.twitterTemplate);
      setSocialMsg('Verification code generated! Please create your post on X using the template below.');
      await loadProfileData();
    } catch (err) {
      setSocialError(err instanceof Error ? err.message : 'Failed to generate code');
    } finally {
      setTwitterBusy(false);
    }
  };

  const handleTwitterVerify = async () => {
    if (!twitterCode) return;
    setTwitterBusy(true);
    setSocialError(null);
    setSocialMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; user: UserProfile }>('/api/social/verify', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'TWITTER',
          handle: twitterInput,
          code: twitterCode,
        }),
      });
      updateUser(res.user);
      setSocialMsg(`Twitter account @${twitterInput.replace(/^@+/, '')} successfully connected!`);
      await loadProfileData();
    } catch (err) {
      setSocialError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setTwitterBusy(false);
    }
  };

  const handleTwitterDisconnect = async () => {
    setTwitterBusy(true);
    try {
      const res = await apiFetch<{ ok: boolean; user: UserProfile }>('/api/social/disconnect', {
        method: 'DELETE',
        body: JSON.stringify({ platform: 'TWITTER' }),
      });
      updateUser(res.user);
      setTwitterCode(null);
      setTwitterTemplate(null);
      setTwitterInput('');
      setSocialMsg('Twitter account disconnected.');
      await loadProfileData();
    } catch (err) {
      setSocialError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setTwitterBusy(false);
    }
  };

  const handleTelegramOpenBot = () => {
    window.open('https://t.me/nimorapay_bot', '_blank');
  };

  const handleTelegramStarted = async () => {
    if (!telegramInput.trim()) {
      setSocialError('Please enter your Telegram handle first.');
      return;
    }
    setTelegramBusy(true);
    setSocialError(null);
    setSocialMsg(null);
    try {
      const res = await apiFetch<{
        verificationCode: string;
        telegramCommand: string;
      }>('/api/social/connect', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'TELEGRAM',
          handle: telegramInput,
        }),
      });
      setTelegramCode(res.verificationCode);
      setTelegramStarted(true);
      setSocialMsg('Connection code generated! Enter /connect ' + res.verificationCode + ' in the Telegram bot.');
      await loadProfileData();
    } catch (err) {
      setSocialError(err instanceof Error ? err.message : 'Failed to generate code');
    } finally {
      setTelegramBusy(false);
    }
  };

  const handleTelegramVerify = async () => {
    if (!telegramCode) return;
    setTelegramBusy(true);
    setSocialError(null);
    setSocialMsg(null);
    try {
      const res = await apiFetch<{ ok: boolean; user: UserProfile }>('/api/social/verify', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'TELEGRAM',
          handle: telegramInput,
          code: telegramCode,
        }),
      });
      updateUser(res.user);
      setSocialMsg(`Telegram account @${telegramInput.replace(/^@+/, '')} successfully connected!`);
      await loadProfileData();
    } catch (err) {
      setSocialError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setTelegramBusy(false);
    }
  };

  const handleTelegramDisconnect = async () => {
    setTelegramBusy(true);
    try {
      const res = await apiFetch<{ ok: boolean; user: UserProfile }>('/api/social/disconnect', {
        method: 'DELETE',
        body: JSON.stringify({ platform: 'TELEGRAM' }),
      });
      updateUser(res.user);
      setTelegramCode(null);
      setTelegramStarted(false);
      setTelegramInput('');
      setSocialMsg('Telegram account disconnected.');
      await loadProfileData();
    } catch (err) {
      setSocialError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setTelegramBusy(false);
    }
  };

  const handleRunSimulation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimBusy(true);
    setSimResult(null);
    try {
      const effectiveSender =
        simSender.trim() ||
        (simPlatform === 'TWITTER'
          ? socialData.twitter?.handle || 'johndoe'
          : socialData.telegram?.handle || 'johndoe');

      const res = await apiFetch<any>('/api/social/simulate', {
        method: 'POST',
        body: JSON.stringify({
          platform: simPlatform,
          senderHandle: effectiveSender,
          text: simText,
        }),
      });
      setSimResult(res);
      await Promise.all([loadProfileData(), syncWalletBalance()]);
    } catch (err) {
      setSimResult({
        success: false,
        status: 'ERROR',
        botResponse: err instanceof Error ? err.message : 'Simulation error',
      });
    } finally {
      setSimBusy(false);
    }
  };

  const sortedLanguages = [...AVAILABLE_LANGUAGES].sort((a, b) => {
    if (a.code === defaultCountryLocale) return -1;
    if (b.code === defaultCountryLocale) return 1;
    return 0;
  });

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white font-display">
            {t('profile.title')}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {t('profile.subtitle')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            logout();
            navigate('/auth');
          }}
          className="min-h-[40px] px-3.5 rounded-xl border border-slate-800 hover:border-red-500/40 text-xs font-semibold text-red-300 flex items-center gap-1.5"
        >
          <LogOut className="w-4 h-4" />
          <span>{t('profile.logoutBtn')}</span>
        </button>
      </div>

      {/* Top Row: Your Wallet Balance & Real Market Reference Price */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
        <div className="lg:col-span-2 rounded-2xl bg-gradient-to-br from-navy-900 via-navy-900 to-navy-950 border border-slate-800 p-5 shadow-xl flex flex-col justify-between">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-medium text-slate-400 flex items-center gap-2">
                <Wallet className="w-3.5 h-3.5 text-gold-400" />
                <span className="font-semibold text-slate-200">
                  {t('home.walletBalance')}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-300">
                  {user ? shortenAddress(user.address) : ''}
                </span>
                <button
                  type="button"
                  onClick={handleManualRefreshWallet}
                  title="Sync Nimiq Wallet Balance"
                  className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-gold-400 transition-colors"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${syncingBalance ? 'animate-spin text-gold-400' : ''}`}
                  />
                </button>
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-white font-mono tabular-nums mt-2 tracking-tight">
                {formatNim(walletBalanceNim, locale)}
              </div>
              <div className="text-xs text-slate-400 font-mono tabular-nums mt-1 flex items-center gap-2">
                <span>
                  ≈ {formatFiat(estimatedFiatBalance, currencyCode, locale)}
                </span>
                {walletBalanceSynced && (
                  <span className="text-[11px] text-emerald-400 font-sans">
                    · Live Synced
                  </span>
                )}
              </div>
            </div>

            {region && (
              <div className="text-end">
                <div className="text-2xl">{region.flag}</div>
                <div className="text-xs font-semibold text-slate-200 mt-1">
                  {region.countryName}
                </div>
                <div className="text-[11px] text-slate-400">
                  {region.currency}
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 pt-3.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>{t('profile.escrowProtected')}</span>
            </div>
            <div>
              {t('profile.completedTrades')}:{' '}
              <span className="text-white font-mono font-bold tabular-nums">
                {user?.completedTrades || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Real Market Rate Card */}
        <div className="rounded-2xl bg-navy-900 border border-slate-800 p-5 flex flex-col justify-between shadow-xl">
          <div>
            <div className="text-xs text-slate-400 font-medium flex items-center justify-between">
              <span>
                {t('home.marketPrice')} ({currencyCode})
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="text-2xl font-bold text-gold-400 font-mono tabular-nums mt-2">
              1 NIM = {formatFiat(liveMarketPrice, currencyCode, locale)}
            </div>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              {t('profile.corridorNote', { country: region?.countryName })}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-400">{t('profile.escrowSla')}</span>
            <span className="font-mono text-slate-200 tabular-nums">
              {t('profile.autoGuard')}
            </span>
          </div>
        </div>
      </div>

      {/* Neat Segmented Navigation Bar for Profile Sub-Sections */}
      <div className="flex items-center gap-1 p-1 bg-navy-900 border border-slate-800 rounded-xl w-full sm:w-fit overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveSection('OVERVIEW')}
          className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeSection === 'OVERVIEW'
              ? 'bg-gold-500 text-navy-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          {t('profile.verifiedIdentityTab')}
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('ADS')}
          className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeSection === 'ADS'
              ? 'bg-gold-500 text-navy-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          {t('profile.myAdsTab')} ({myAds.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSection('METHODS')}
          className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeSection === 'METHODS'
              ? 'bg-gold-500 text-navy-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          {t('profile.paymentMethodsTab')} ({methods.length})
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveSection('SETTINGS');
            setSettingsSubSection('GENERAL');
          }}
          className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            activeSection === 'SETTINGS' && settingsSubSection === 'GENERAL'
              ? 'bg-gold-500 text-navy-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          {t('profile.settingsTab')}
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveSection('SETTINGS');
            setSettingsSubSection('SOCIAL');
          }}
          className={`min-h-[38px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5 ${
            activeSection === 'SETTINGS' && settingsSubSection === 'SOCIAL'
              ? 'bg-gold-500 text-navy-950'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <AtSign className="w-3.5 h-3.5" />
          <span>{t('profile.socialTab')}</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-950/60 border border-red-500/40 p-3.5 text-xs text-red-200 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-300 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* SECTION 1: VERIFIED IDENTITY */}
      {activeSection === 'OVERVIEW' && (
        <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4 shadow-xl">
          <div className="flex items-center justify-between text-xs text-amber-300 font-semibold">
            <span className="flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>{t('profile.lockedBadge')}</span>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
            <div className="rounded-xl bg-navy-950 border border-slate-800 p-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-400">
                  {t('profile.verifiedRealName')}
                </div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {user?.realName}
                </div>
              </div>
              <Lock className="w-4 h-4 text-slate-500" />
            </div>

            <div className="rounded-xl bg-navy-950 border border-slate-800 p-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-400">
                  {t('profile.lockedCountryCurrency')}
                </div>
                <div className="text-sm font-bold text-white mt-0.5">
                  {region?.flag} {region?.countryName} ({user?.country}) ·{' '}
                  {region?.currency}
                </div>
              </div>
              <Lock className="w-4 h-4 text-slate-500" />
            </div>

            <div className="md:col-span-2 rounded-xl bg-navy-950 border border-slate-800 p-4">
              <div className="text-[11px] text-slate-400">
                {t('profile.nimiqWalletAddress')}
              </div>
              <div className="text-xs font-mono text-gold-400 mt-1 break-all">
                {user?.address}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: MY P2P ADS & POST AD (Exclusively in Profile Menu) */}
      {activeSection === 'ADS' && (
        <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-5 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-white font-display">
                {t('profile.myLocalAdsTitle')} ({region?.currency})
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {t('profile.myLocalAdsSubtitle', {
                  country: region?.countryName,
                })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateAdOpen(true)}
              className="min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-bold text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{t('p2p.createAdBtn')}</span>
            </button>
          </div>

          {myAds.length === 0 ? (
            <div className="rounded-xl bg-navy-950 border border-slate-800 p-6 text-center space-y-3">
              <div className="text-sm font-semibold text-white">
                {t('profile.noAdsYet')}
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {t('profile.noAdsHint', { country: region?.countryName })}
              </p>
              <button
                type="button"
                onClick={() => setCreateAdOpen(true)}
                className="min-h-[40px] px-4 rounded-xl bg-gold-500 text-navy-950 font-bold text-xs"
              >
                {t('profile.postNewAdBtn')}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {myAds.map((ad) => (
                <div
                  key={ad.id}
                  className="rounded-xl bg-navy-950 border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div>
                    <div className="text-xs text-slate-400">
                      <span
                        className={`font-bold ${
                          ad.side === 'SELL_NIM'
                            ? 'text-gold-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {ad.side === 'SELL_NIM'
                          ? t('home.sellingNim')
                          : t('home.buyingNim')}
                      </span>{' '}
                      · {ad.country} ({ad.fiatCurrency}) · {t('common.status')}:{' '}
                      <span className="text-white font-semibold">{ad.status}</span>
                    </div>
                    <div className="text-sm font-bold text-white font-mono tabular-nums mt-1">
                      {t('p2p.pricePerNim')}:{' '}
                      {formatFiat(ad.price, ad.fiatCurrency, locale)} / NIM ·{' '}
                      {t('p2p.available')}: {formatNim(ad.availableNim, locale)}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {t('p2p.limits')}: {ad.minAmountNim} – {ad.maxAmountNim} NIM ·{' '}
                      {ad.paymentMethodProviders.map((p) => p.name).join(', ')}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      const nextStatus =
                        ad.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
                      await apiFetch(`/api/p2p/ads/${ad.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ status: nextStatus }),
                      });
                      loadProfileData();
                    }}
                    className="min-h-[38px] px-4 rounded-xl border border-slate-700 text-xs font-semibold text-slate-200 hover:bg-slate-800 shrink-0"
                  >
                    {ad.status === 'ACTIVE'
                      ? t('profile.pauseAd')
                      : t('profile.resumeAd')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: COUNTRY PAYMENT METHODS */}
      {activeSection === 'METHODS' && (
        <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-5 shadow-xl">
          <div>
            <h2 className="text-base font-bold text-white font-display">
              {t('profile.paymentMethods')} ({region?.flag} {region?.countryName})
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {t('profile.holderMatchHint')}
            </p>
          </div>

          <form onSubmit={handleAddPaymentMethod} className="space-y-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1">
                {region?.countryName} {t('profile.providerLabel')}
              </label>
              <select
                value={providerCode}
                onChange={(e) => setProviderCode(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-gold-500"
              >
                {region?.paymentMethods.map((pm) => (
                  <option key={pm.code} value={pm.code}>
                    {pm.name} ({pm.type})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1">
                  {t('profile.holderNameLabel')}
                </label>
                <input
                  type="text"
                  required
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1">
                  {selectedProviderDef?.fields.includes('iban')
                    ? 'IBAN'
                    : selectedProviderDef?.fields.includes('phone')
                    ? t('profile.phoneNumberLabel')
                    : t('profile.accountNumberLabel')}
                </label>
                <input
                  type="text"
                  required
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder={
                    selectedProviderDef?.placeholder || 'Account / Phone / IBAN'
                  }
                  className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono"
                />
              </div>
            </div>

            {selectedProviderDef?.fields.includes('routingNumber') && (
              <div>
                <label className="block text-xs font-semibold text-slate-200 mb-1">
                  ABA Routing Number
                </label>
                <input
                  type="text"
                  required
                  value={routingNumber}
                  onChange={(e) => setRoutingNumber(e.target.value)}
                  placeholder="9-digit routing number"
                  className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={adding}
              className="min-h-[44px] px-5 rounded-xl bg-gold-500 text-navy-950 font-bold text-xs flex items-center gap-1.5 hover:brightness-105"
            >
              <Plus className="w-4 h-4" />
              <span>{adding ? t('common.loading') : t('profile.addMethodBtn')}</span>
            </button>
          </form>

          <div className="pt-4 border-t border-slate-800 space-y-2.5">
            <div className="text-xs font-bold text-slate-300">
              {t('profile.savedAccounts')} ({methods.length})
            </div>
            {methods.length === 0 ? (
              <div className="text-xs text-slate-500">
                {t('profile.noSavedMethods')}
              </div>
            ) : (
              methods.map((m) => (
                <div
                  key={m.id}
                  className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-bold text-white">
                      {m.providerName} ({m.type})
                    </div>
                    <div className="text-slate-400 mt-0.5">
                      <span className="text-slate-200">{m.accountName}</span> ·{' '}
                      <span className="font-mono text-gold-400">
                        {m.accountNumberMasked}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch(`/api/payment-methods/${m.id}`, {
                        method: 'DELETE',
                      });
                      loadProfileData();
                    }}
                    className="min-h-[38px] min-w-[38px] rounded-lg hover:bg-red-950/50 text-slate-400 hover:text-red-300 flex items-center justify-center"
                    title="Remove payment method"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* SECTION 4: SETTINGS & SOCIAL MANAGEMENT */}
      {activeSection === 'SETTINGS' && (
        <div className="space-y-5">
          {/* Settings Sub-Navigation: General vs Social */}
          <div className="flex items-center gap-2 p-1 bg-navy-900 border border-slate-800 rounded-xl w-fit">
            <button
              type="button"
              onClick={() => setSettingsSubSection('GENERAL')}
              className={`min-h-[36px] px-4 rounded-lg text-xs font-semibold transition-colors ${
                settingsSubSection === 'GENERAL'
                  ? 'bg-gold-500 text-navy-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {t('profile.settingsTab')}
            </button>
            <button
              type="button"
              onClick={() => setSettingsSubSection('SOCIAL')}
              className={`min-h-[36px] px-4 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                settingsSubSection === 'SOCIAL'
                  ? 'bg-gold-500 text-navy-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <AtSign className="w-3.5 h-3.5" />
              <span>{t('profile.socialTab')}</span>
            </button>
          </div>

          {/* SUB-SECTION 4A: GENERAL (Language & Appearance) */}
          {settingsSubSection === 'GENERAL' && (
            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-5 shadow-xl">
              <div>
                <div className="flex items-center gap-2 text-sm font-bold text-white font-display">
                  <Globe className="w-4 h-4 text-gold-400" />
                  <span>{t('profile.languageLabel')}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {t('profile.languageHint', { country: region?.countryName })}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {sortedLanguages.map((lang) => {
                  const isDefault = lang.code === defaultCountryLocale;
                  const isActive = user?.locale === lang.code;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => handleLanguageChange(lang.code)}
                      className={`min-h-[42px] px-3.5 rounded-xl border text-xs flex items-center justify-between transition-colors ${
                        isActive
                          ? 'bg-gold-500/15 border-gold-500/50 text-white font-bold'
                          : 'bg-navy-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <span>
                        {lang.label} ({lang.native})
                      </span>
                      {isDefault && (
                        <span className="text-[11px] text-gold-400 font-medium">
                          {t('profile.countryDefaultTag')}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-300">
                  {t('profile.themeLabel')}
                </span>
                <button
                  type="button"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="min-h-[40px] px-4 rounded-xl bg-navy-950 border border-slate-800 text-xs font-semibold text-slate-200 flex items-center gap-2 hover:border-gold-500/50 transition-colors"
                >
                  {theme === 'dark' ? (
                    <>
                      <Moon className="w-4 h-4 text-gold-400" />
                      <span>{t('profile.darkMode')}</span>
                    </>
                  ) : (
                    <>
                      <Sun className="w-4 h-4 text-gold-500" />
                      <span>{t('profile.lightMode')}</span>
                    </>
                  )}
                </button>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-gold-400" />
                    <span>Admin Command Center</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    Restricted console for platform administration & cashback
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/admin')}
                  className="min-h-[38px] px-3.5 rounded-xl bg-gold-500/15 hover:bg-gold-500/25 border border-gold-500/40 text-xs font-bold text-gold-300 flex items-center gap-1.5 transition-colors"
                >
                  <span>Open Admin</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* SUB-SECTION 4B: SOCIAL (Twitter / X & Telegram Payments) */}
          {settingsSubSection === 'SOCIAL' && (
            <div className="space-y-6">
              {/* Feedback messages */}
              {socialMsg && (
                <div className="rounded-xl bg-emerald-950/60 border border-emerald-500/40 p-4 text-xs text-emerald-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{socialMsg}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSocialMsg(null)}
                    className="text-emerald-300 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {socialError && (
                <div className="rounded-xl bg-red-950/60 border border-red-500/40 p-4 text-xs text-red-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>{socialError}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSocialError(null)}
                    className="text-red-300 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Title & Explanatory Banner */}
              <div className="rounded-2xl bg-gradient-to-br from-navy-900 via-navy-900 to-navy-950 border border-slate-800 p-6 shadow-xl space-y-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-gold-500/20 border border-gold-500/40 flex items-center justify-center text-gold-400">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-white font-display">
                      {t('profile.socialTitle')}
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {t('profile.socialSubtitle')}
                    </p>
                  </div>
                </div>
              </div>

              {/* 2-Column Grid: Twitter Card & Telegram Card */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* 1. TWITTER (X) OPTION */}
                <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-5 shadow-xl">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-black border border-slate-700 flex items-center justify-center text-white font-bold text-sm">
                        𝕏
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">
                          {t('profile.twitterSectionTitle')}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          @nimorapay Tip Bot
                        </div>
                      </div>
                    </div>

                    {socialData.twitter?.isVerified ? (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold text-xs flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>@{socialData.twitter.handle}</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 text-xs">
                        {t('profile.notConnectedBadge')}
                      </span>
                    )}
                  </div>

                  {socialData.twitter?.isVerified ? (
                    <div className="space-y-4">
                      <div className="rounded-xl bg-emerald-950/30 border border-emerald-500/30 p-4 space-y-2">
                        <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Connected to @{socialData.twitter.handle}</span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          Your Twitter account is locked to your Nimora wallet ({shortenAddress(user?.address || '')}).
                          Whenever someone tips or awards you $NIM on X, it will land directly in this wallet!
                        </p>
                      </div>

                      <div className="rounded-xl bg-navy-950 border border-slate-800 p-4 space-y-2 text-xs">
                        <div className="font-bold text-gold-400 flex items-center gap-1.5">
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>{t('profile.howToTipTwitterTitle')}</span>
                        </div>
                        <p className="text-slate-300 text-[11px]">
                          {t('profile.howToTipTwitterText')}
                        </p>
                        <div className="space-y-1.5 pt-1">
                          <div className="p-2.5 rounded-lg bg-navy-900 border border-slate-800 font-mono text-[11px] text-slate-200">
                            "Bro, you're awesome! I'm sending you a little something—not much, but here you go: <span className="text-gold-400 font-bold">@nimorapay 1000</span>"
                          </div>
                          <div className="p-2.5 rounded-lg bg-navy-900 border border-slate-800 font-mono text-[11px] text-slate-200">
                            "Congratulations to the $NIM giveaway winner, @recipient! You've won 500 $NIM—<span className="text-gold-400 font-bold">@nimorapay 500</span>"
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400 italic pt-1">
                          The text can be anything! An AI processes the post and @nimorapay responds dynamically with unique energetic replies.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={handleTwitterDisconnect}
                        disabled={twitterBusy}
                        className="w-full min-h-[40px] rounded-xl border border-red-500/30 hover:bg-red-950/40 text-red-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{twitterBusy ? t('common.loading') : t('profile.disconnectBtn')}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <form onSubmit={handleTwitterConnect} className="space-y-3">
                        <div>
                          <label className="block text-xs font-semibold text-slate-200 mb-1">
                            {t('profile.enterTwitterHandle')}
                          </label>
                          <div className="relative">
                            <span className="absolute start-3.5 top-3 text-slate-500 text-sm font-mono">
                              @
                            </span>
                            <input
                              type="text"
                              required
                              value={twitterInput.replace(/^@+/, '')}
                              onChange={(e) => setTwitterInput(e.target.value.replace(/^@+/, ''))}
                              placeholder="username"
                              className="w-full h-11 ps-8 pe-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white font-mono focus:outline-none focus:border-gold-500"
                            />
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={twitterBusy || !twitterInput.trim()}
                          className="w-full min-h-[44px] rounded-xl bg-gold-500 hover:bg-gold-400 text-navy-950 font-bold text-xs flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                        >
                          <Sparkles className="w-4 h-4" />
                          <span>{twitterBusy ? t('common.loading') : t('profile.getVerificationCodeBtn')}</span>
                        </button>
                      </form>

                      {twitterCode && (
                        <div className="pt-4 border-t border-slate-800 space-y-3.5">
                          <div>
                            <div className="text-[11px] font-semibold text-slate-400 mb-1">
                              Verification Code:
                            </div>
                            <div className="p-3 rounded-xl bg-navy-950 border border-gold-500/40 flex items-center justify-between font-mono font-bold text-gold-400 text-sm">
                              <span>{twitterCode}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(twitterCode, 'x_code')}
                                className="px-2.5 py-1 rounded-lg bg-navy-900 border border-slate-700 text-xs text-slate-200 hover:text-white flex items-center gap-1"
                              >
                                {copiedKey === 'x_code' ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>{t('common.copied')}</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>{t('common.copy')}</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] font-semibold text-slate-400 mb-1">
                              {t('profile.twitterPostTemplateLabel')}
                            </div>
                            <div className="p-3 rounded-xl bg-navy-950 border border-slate-800 text-xs text-slate-200 font-mono leading-relaxed relative group">
                              "{twitterTemplate || formatTwitterTemplate(twitterCode)}"
                              <div className="mt-2.5 flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    copyToClipboard(
                                      twitterTemplate || formatTwitterTemplate(twitterCode),
                                      'x_template'
                                    )
                                  }
                                  className="min-h-[34px] px-3 rounded-lg bg-navy-900 border border-slate-700 text-[11px] font-semibold text-slate-200 hover:text-white flex items-center gap-1"
                                >
                                  {copiedKey === 'x_template' ? (
                                    <>
                                      <Check className="w-3 h-3 text-emerald-400" />
                                      <span>Copied Template</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3 h-3" />
                                      <span>Copy Template</span>
                                    </>
                                  )}
                                </button>
                                <a
                                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                                    twitterTemplate || formatTwitterTemplate(twitterCode)
                                  )}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="min-h-[34px] px-3 rounded-lg bg-black border border-slate-700 text-[11px] font-bold text-white flex items-center gap-1.5 hover:border-slate-500"
                                >
                                  <span>𝕏</span>
                                  <span>{t('profile.postOnXBtn')}</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            </div>
                          </div>

                          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3.5 flex items-center gap-3">
                            <RefreshCw className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                            <div>
                              <div className="text-xs font-bold text-amber-300">
                                Waiting for connection verification
                              </div>
                              <div className="text-[11px] text-slate-300 mt-0.5">
                                Post on X with the template above. Once @nimorapay detects your post, status will update to &quot;Your Twitter connection is successful.&quot;
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* 2. TELEGRAM BOT OPTION */}
                <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-5 shadow-xl">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-sky-400 font-bold text-sm">
                        <Send className="w-4 h-4 -rotate-45" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">
                          {t('profile.telegramSectionTitle')}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          @nimorapay_bot
                        </div>
                      </div>
                    </div>

                    {socialData.telegram?.isVerified ? (
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-semibold text-xs flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        <span>@{socialData.telegram.handle}</span>
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 text-xs">
                        {t('profile.notConnectedBadge')}
                      </span>
                    )}
                  </div>

                  {socialData.telegram?.isVerified ? (
                    <div className="space-y-4">
                      <div className="rounded-xl bg-emerald-950/30 border border-emerald-500/30 p-4 space-y-2">
                        <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Connected to @{socialData.telegram.handle}</span>
                        </div>
                        <p className="text-[11px] text-slate-300 leading-relaxed">
                          Your Telegram account is locked to your Nimora wallet ({shortenAddress(user?.address || '')}).
                          You can now transfer NIM directly in the Telegram bot with `/pay @recipient &lt;amount&gt;`.
                        </p>
                      </div>

                      <div className="rounded-xl bg-navy-950 border border-slate-800 p-4 space-y-2 text-xs">
                        <div className="font-bold text-sky-400 flex items-center gap-1.5">
                          <Bot className="w-3.5 h-3.5" />
                          <span>{t('profile.howToTipTelegramTitle')}</span>
                        </div>
                        <p className="text-slate-300 text-[11px]">
                          {t('profile.howToTipTelegramText')}
                        </p>
                        <div className="p-2.5 rounded-lg bg-navy-900 border border-slate-800 font-mono text-[11px] text-slate-200">
                          /pay @recipient 1000
                        </div>
                        <p className="text-[11px] text-slate-400 italic pt-1">
                          If successful, the bot responds: "You have just transferred 1000 $NIM to @recipient." If the recipient has not registered, it informs you that they haven't registered in the mini app yet.
                        </p>
                        <div className="pt-2">
                          <button
                            type="button"
                            onClick={handleTelegramOpenBot}
                            className="min-h-[36px] px-3 rounded-lg bg-sky-500 text-navy-950 font-bold text-xs flex items-center gap-1.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Launch @nimorapay_bot</span>
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={handleTelegramDisconnect}
                        disabled={telegramBusy}
                        className="w-full min-h-[40px] rounded-xl border border-red-500/30 hover:bg-red-950/40 text-red-300 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{telegramBusy ? t('common.loading') : t('profile.disconnectBtn')}</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-semibold text-slate-200 mb-1">
                          {t('profile.enterTelegramHandle')}
                        </label>
                        <div className="relative">
                          <span className="absolute start-3.5 top-3 text-slate-500 text-sm font-mono">
                            @
                          </span>
                          <input
                            type="text"
                            required
                            value={telegramInput.replace(/^@+/, '')}
                            onChange={(e) => setTelegramInput(e.target.value.replace(/^@+/, ''))}
                            placeholder="username"
                            className="w-full h-11 ps-8 pe-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white font-mono focus:outline-none focus:border-sky-400"
                          />
                        </div>
                      </div>

                      {/* As requested: After entering the handle, a button labeled "Open Bot" will appear;
                          the user clicks this to open the Telegram mini-app, then selects "I have started the bot"
                          (located below the "Open Bot" button). This will generate a connection code. */}
                      {telegramInput.trim().length > 0 && (
                        <div className="space-y-2.5 pt-1">
                          {/* Button 1: Open Bot */}
                          <button
                            type="button"
                            onClick={handleTelegramOpenBot}
                            className="w-full min-h-[44px] rounded-xl bg-sky-500 hover:bg-sky-400 text-navy-950 font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-sky-500/10"
                          >
                            <ExternalLink className="w-4 h-4" />
                            <span>{t('profile.openBotBtn')}</span>
                          </button>

                          {/* Button 2: I have started the bot (located below Open Bot) */}
                          <button
                            type="button"
                            onClick={handleTelegramStarted}
                            disabled={telegramBusy}
                            className="w-full min-h-[44px] rounded-xl bg-navy-950 border border-sky-500/50 hover:bg-sky-500/10 text-sky-300 font-bold text-xs flex items-center justify-center gap-2 transition-all"
                          >
                            <Check className="w-4 h-4 text-sky-400" />
                            <span>{telegramBusy ? t('common.loading') : t('profile.startedBotBtn')}</span>
                          </button>
                        </div>
                      )}

                      {/* Display Connection Code & Command once generated */}
                      {telegramCode && (
                        <div className="pt-4 border-t border-slate-800 space-y-3.5">
                          <div>
                            <div className="text-[11px] font-semibold text-slate-400 mb-1">
                              Connection Code:
                            </div>
                            <div className="p-3 rounded-xl bg-navy-950 border border-sky-500/40 flex items-center justify-between font-mono font-bold text-sky-400 text-sm">
                              <span>{telegramCode}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(telegramCode, 'tg_code')}
                                className="px-2.5 py-1 rounded-lg bg-navy-900 border border-slate-700 text-xs text-slate-200 hover:text-white flex items-center gap-1"
                              >
                                {copiedKey === 'tg_code' ? (
                                  <>
                                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    <span>{t('common.copied')}</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>{t('common.copy')}</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          <div>
                            <div className="text-[11px] font-semibold text-slate-400 mb-1">
                              {t('profile.telegramInstruction')}
                            </div>
                            <div className="p-3 rounded-xl bg-navy-950 border border-slate-800 flex items-center justify-between font-mono text-xs text-white">
                              <span>{formatTelegramCommand(telegramCode)}</span>
                              <button
                                type="button"
                                onClick={() =>
                                  copyToClipboard(
                                    formatTelegramCommand(telegramCode),
                                    'tg_cmd'
                                  )
                                }
                                className="px-2.5 py-1 rounded-lg bg-navy-900 border border-slate-700 text-[11px] text-slate-200 hover:text-white flex items-center gap-1"
                              >
                                {copiedKey === 'tg_cmd' ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    <span>Copied Command</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3" />
                                    <span>Copy Command</span>
                                  </>
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="rounded-xl bg-sky-500/10 border border-sky-500/30 p-3.5 flex items-center gap-3">
                            <RefreshCw className="w-4 h-4 text-sky-400 animate-spin shrink-0" />
                            <div>
                              <div className="text-xs font-bold text-sky-300">
                                Waiting for connection verification
                              </div>
                              <div className="text-[11px] text-slate-300 mt-0.5">
                                Send <code className="text-white font-mono">{formatTelegramCommand(telegramCode)}</code> to the Telegram bot. Once detected, status will update to &quot;Your Telegram connection is successful.&quot;
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* 3. INTERACTIVE SIMULATOR & TEST CONSOLE */}
              <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-5 shadow-xl">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
                  <div>
                    <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
                      <Bot className="w-4 h-4 text-gold-400" />
                      <span>{t('profile.testerTitle')}</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Test sending tips on Twitter/X or executing Telegram bot commands in real time.
                    </p>
                  </div>

                  <div className="flex items-center gap-1 p-1 bg-navy-950 border border-slate-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setSimPlatform('TWITTER');
                        setSimText("Bro, you're awesome! I'm sending you a little something—not much, but here you go: @nimorapay 1000");
                      }}
                      className={`px-3 py-1.5 rounded text-xs font-semibold ${
                        simPlatform === 'TWITTER'
                          ? 'bg-gold-500 text-navy-950'
                          : 'text-slate-300'
                      }`}
                    >
                      𝕏 Twitter Mention
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSimPlatform('TELEGRAM');
                        setSimText('/pay @rakasantoso 500');
                      }}
                      className={`px-3 py-1.5 rounded text-xs font-semibold ${
                        simPlatform === 'TELEGRAM'
                          ? 'bg-sky-500 text-navy-950'
                          : 'text-slate-300'
                      }`}
                    >
                      Telegram Bot Command
                    </button>
                  </div>
                </div>

                <form onSubmit={handleRunSimulation} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Sender Handle
                      </label>
                      <input
                        type="text"
                        value={simSender}
                        onChange={(e) => setSimSender(e.target.value)}
                        placeholder={
                          simPlatform === 'TWITTER'
                            ? (socialData.twitter?.handle || 'rakasantoso')
                            : (socialData.telegram?.handle || 'nadiaputri')
                        }
                        className="w-full h-10 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Target/Recipient Quick Suggestion
                      </label>
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {socialData.demoPeers.map((p) => (
                          <button
                            key={p.handle}
                            type="button"
                            onClick={() => {
                              if (simPlatform === 'TWITTER') {
                                setSimText(`Congratulations @${p.handle}! You've won 500 $NIM—@nimorapay 500`);
                              } else {
                                setSimText(`/pay @${p.handle} 500`);
                              }
                            }}
                            className="px-2 py-1 rounded bg-navy-950 border border-slate-800 text-[11px] font-mono text-slate-300 hover:text-gold-400 hover:border-gold-500/40"
                          >
                            @{p.handle}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      {simPlatform === 'TWITTER' ? 'Post / Comment Text (must end with @nimorapay <amount>)' : 'Bot Command (/pay @recipient <amount> or /connect <code>)'}
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={simText}
                      onChange={(e) => setSimText(e.target.value)}
                      placeholder={
                        simPlatform === 'TWITTER'
                          ? "Bro, you're awesome! Here is a tip: @nimorapay 1000"
                          : "/pay @recipient 1000"
                      }
                      className="w-full p-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono focus:outline-none focus:border-gold-500 leading-relaxed"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={simBusy || !simText.trim()}
                    className="min-h-[42px] px-5 rounded-xl bg-gold-500 hover:bg-gold-400 text-navy-950 font-bold text-xs flex items-center gap-2 disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{simBusy ? 'Processing with AI…' : 'Run Simulation & Process AI'}</span>
                  </button>
                </form>

                {simResult && (
                  <div className="rounded-xl bg-navy-950 border border-slate-800 p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-200">
                        {simPlatform === 'TWITTER' ? '𝕏 @nimorapay AI Response:' : '🤖 Telegram Bot Response:'}
                      </span>
                      <span
                        className={`font-semibold px-2 py-0.5 rounded text-[10px] ${
                          simResult.success
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-red-500/20 text-red-400'
                        }`}
                      >
                        {simResult.status}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-lg bg-navy-900 border border-slate-800 text-xs text-slate-100 font-sans leading-relaxed">
                      "{simResult.botResponse}"
                    </div>

                    {simResult.parsed && (
                      <div className="text-[11px] text-slate-400 font-mono flex flex-wrap gap-3 pt-1">
                        <span>Extracted Amount: <strong className="text-gold-400">{simResult.parsed.amountNim} NIM</strong></span>
                        <span>Recipient: <strong className="text-slate-200">@{simResult.parsed.recipientHandle}</strong></span>
                        <span>Intent: <strong className="text-slate-200">{simResult.parsed.intent}</strong></span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 4. RECENT SOCIAL MEDIA TRANSFERS FEED */}
              <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white font-display">
                    {t('profile.recentSocialTransfersTitle')} ({socialTransfers.length})
                  </h3>
                  <button
                    type="button"
                    onClick={loadProfileData}
                    className="p-1 rounded text-slate-400 hover:text-white"
                    title="Refresh transfers"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {socialTransfers.length === 0 ? (
                  <div className="rounded-xl bg-navy-950 border border-slate-800 p-6 text-center text-xs text-slate-400">
                    No social media transfers recorded yet. Try sending a tip using the simulator above or tagging @nimorapay on X!
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-72 overflow-y-auto">
                    {socialTransfers.map((tx) => (
                      <div
                        key={tx.id}
                        className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-400">
                              {tx.platform === 'TWITTER' ? '𝕏 Twitter' : '✈ Telegram'}
                            </span>
                            <span>·</span>
                            <span className="font-mono text-slate-200">
                              @{tx.senderHandle} → @{tx.recipientHandle}
                            </span>
                            <span>·</span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                tx.status === 'SUCCESS'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-amber-500/20 text-amber-300'
                              }`}
                            >
                              {tx.status}
                            </span>
                          </div>

                          <div className="text-[11px] text-slate-300 mt-1 italic">
                            "{tx.botResponse}"
                          </div>
                        </div>

                        <div className="text-end shrink-0">
                          <div className="font-mono font-bold text-gold-400">
                            {tx.amountNim} NIM
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                            {new Date(tx.createdAt).toLocaleTimeString(locale)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SECTION: CASHBACK REWARDS HUB */}
      {activeSection === 'CASHBACK' && (
        <div className="space-y-6">
          {/* Hero Banner */}
          <div className="rounded-3xl bg-gradient-to-br from-navy-900 via-navy-900 to-amber-950/40 border border-gold-500/30 p-6 space-y-4 shadow-xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-gold-500/20 text-gold-400 flex items-center justify-center flex-shrink-0">
                  <Gift className="w-6 h-6 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white font-display flex items-center gap-2">
                    <span>Nimora Cashback Rewards Hub</span>
                  </h2>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Get random <span className="text-gold-400 font-bold">200 up to 5,000 $NIM</span> cashback on eligible platform transactions!
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold ${
                    cashbackPromo.isActive
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {cashbackPromo.isActive ? '● PROMOTION ACTIVE' : 'PROMOTION PAUSED'}
                </span>
              </div>
            </div>

            {/* User Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="rounded-2xl bg-navy-950/70 border border-slate-800 p-4">
                <div className="text-[11px] text-slate-400">Total Cashback Earned</div>
                <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                  +{formatNim(totalCashbackEarned)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Paid directly to wallet</div>
              </div>

              <div className="rounded-2xl bg-navy-950/70 border border-slate-800 p-4">
                <div className="text-[11px] text-slate-400">Pending Review</div>
                <div className="text-xl font-bold font-mono text-amber-400 mt-1">
                  +{formatNim(pendingCashbackTotal)}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Awaiting manual admin check</div>
              </div>

              <div className="rounded-2xl bg-navy-950/70 border border-slate-800 p-4">
                <div className="text-[11px] text-slate-400">Eligibility Minimum</div>
                <div className="text-xl font-bold font-mono text-white mt-1">
                  {cashbackPromo.minTxAmountNim.toLocaleString()} NIM
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">Min transaction amount</div>
              </div>
            </div>
          </div>

          {/* How Cashback Works Card */}
          <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4">
            <h3 className="text-sm font-bold text-white font-display flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>How To Unlock & Receive Cashback</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="rounded-xl bg-navy-950 border border-slate-800 p-4 space-y-2">
                <div className="w-7 h-7 rounded-lg bg-gold-500/10 text-gold-400 font-bold flex items-center justify-center">
                  1
                </div>
                <div className="font-bold text-white">Eligible Transaction (≥ 5,000 NIM)</div>
                <p className="text-slate-400 leading-relaxed text-[11px]">
                  Make any of the 3 supported operations with at least 5,000 $NIM:
                </p>
                <ul className="text-[11px] text-slate-300 space-y-1 pt-1">
                  <li>• <strong className="text-white">P2P Sales Order:</strong> Sell 5,000+ NIM</li>
                  <li>• <strong className="text-white">Social Tip:</strong> Send 5,000+ NIM tip on X/Telegram</li>
                  <li>• <strong className="text-white">Red Packet:</strong> Fund 5,000+ NIM Red Packet</li>
                </ul>
              </div>

              <div className="rounded-xl bg-navy-950 border border-slate-800 p-4 space-y-2">
                <div className="w-7 h-7 rounded-lg bg-sky-500/10 text-sky-400 font-bold flex items-center justify-center">
                  2
                </div>
                <div className="font-bold text-white">Random Reward Unlocked</div>
                <p className="text-slate-400 leading-relaxed text-[11px]">
                  The system generates a random cashback claim of <strong className="text-white">200 up to 5,000 $NIM</strong> and places it in pending review.
                </p>
                <div className="text-[11px] text-slate-400">
                  Backed by the platform's dedicated escrow wallet.
                </div>
              </div>

              <div className="rounded-xl bg-navy-950 border border-slate-800 p-4 space-y-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-400 font-bold flex items-center justify-center">
                  3
                </div>
                <div className="font-bold text-white">Anti-Fraud Check & Automatic Payout</div>
                <p className="text-slate-400 leading-relaxed text-[11px]">
                  To protect platform safety, the admin manually verifies there is no suspicious activity.
                </p>
                <p className="text-[11px] text-emerald-400 font-medium">
                  Upon admin confirmation, the cashback is automatically paid directly to your Nimiq wallet!
                </p>
              </div>
            </div>
          </div>

          {/* User's Cashback Claims History */}
          <div className="rounded-2xl bg-navy-900 border border-slate-800 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white font-display">
                  My Cashback Rewards ({myCashbackClaims.length})
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Track your pending and confirmed rewards.
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadProfileData()}
                className="px-3 py-1.5 rounded-lg bg-navy-950 border border-slate-700 text-slate-300 hover:text-white text-xs flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>

            {myCashbackClaims.length === 0 ? (
              <div className="rounded-xl bg-navy-950/60 border border-slate-800 p-8 text-center text-xs text-slate-400 space-y-2">
                <Gift className="w-8 h-8 text-slate-500 mx-auto" />
                <div className="font-semibold text-slate-300">No Cashback Claims Yet</div>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                  Complete a P2P sales order, send a social tip, or fund a Red Packet of 5,000+ NIM while the event is active to receive random rewards!
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {myCashbackClaims.map((claim) => (
                  <div
                    key={claim.id}
                    className="rounded-xl bg-navy-950 border border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            claim.txType === 'P2P_SELL_ORDER'
                              ? 'bg-emerald-500/20 text-emerald-400'
                              : claim.txType === 'TIP_TRANSACTION'
                              ? 'bg-sky-500/20 text-sky-400'
                              : 'bg-rose-500/20 text-rose-400'
                          }`}
                        >
                          {claim.txType === 'P2P_SELL_ORDER'
                            ? 'P2P Sales Order'
                            : claim.txType === 'TIP_TRANSACTION'
                            ? 'Social Tip'
                            : 'Red Packet'}
                        </span>
                        <span>·</span>
                        <span className="text-slate-400">
                          Original Tx: {formatNim(claim.txAmountNim)}
                        </span>
                        <span>·</span>
                        <span className="text-slate-500">
                          {new Date(claim.createdAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-400 mt-1">
                        {claim.status === 'CONFIRMED' && claim.txHash && (
                          <span className="text-emerald-400 font-mono">
                            Paid to wallet · tx: {claim.txHash.slice(0, 14)}…
                          </span>
                        )}
                        {claim.status === 'PENDING' && (
                          <span className="text-amber-400">
                            Awaiting manual admin anti-fraud check. Payout will execute automatically upon approval.
                          </span>
                        )}
                        {claim.status === 'REJECTED' && (
                          <span className="text-rose-400">
                            Rejected: {claim.adminNotes || 'Unverified activity'}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                      <div className="text-end">
                        <div className="text-sm font-mono font-extrabold text-gold-400">
                          +{formatNim(claim.cashbackAmountNim)}
                        </div>
                        <div className="text-[10px] text-slate-500">Reward</div>
                      </div>

                      <span
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
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
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}


      {/* Modal: Create New P2P Ad (Hosted in Profile Menu) */}
      {createAdOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateAd}
            className="bg-navy-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white font-display">
                {t('p2p.createAdBtn')} ({region?.currency})
              </h3>
              <button
                type="button"
                onClick={() => setCreateAdOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {methods.length === 0 ? (
              <div className="rounded-xl bg-amber-950/40 border border-amber-500/40 p-4 text-xs text-amber-200 space-y-3">
                <p>{t('profile.noAdsHint', { country: region?.countryName })}</p>
                <button
                  type="button"
                  onClick={() => {
                    setCreateAdOpen(false);
                    setActiveSection('METHODS');
                  }}
                  className="min-h-[40px] px-4 rounded-xl bg-gold-500 text-navy-950 font-bold"
                >
                  {t('profile.paymentMethodsTab')}
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewAdSide('SELL_NIM')}
                    className={`min-h-[40px] rounded-xl text-xs font-bold ${
                      newAdSide === 'SELL_NIM'
                        ? 'bg-gold-500 text-navy-950'
                        : 'bg-navy-950 text-slate-300 border border-slate-800'
                    }`}
                  >
                    {t('p2p.sellTab')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewAdSide('BUY_NIM')}
                    className={`min-h-[40px] rounded-xl text-xs font-bold ${
                      newAdSide === 'BUY_NIM'
                        ? 'bg-emerald-500 text-navy-950'
                        : 'bg-navy-950 text-slate-300 border border-slate-800'
                    }`}
                  >
                    {t('p2p.buyTab')}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      {t('p2p.pricePerNim')} ({region?.currency})
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={newAdPrice}
                      onChange={(e) => setNewAdPrice(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      {t('p2p.available')} (NIM)
                    </label>
                    <input
                      type="number"
                      required
                      value={newAdAvail}
                      onChange={(e) => setNewAdAvail(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      Min (NIM)
                    </label>
                    <input
                      type="number"
                      required
                      value={newAdMin}
                      onChange={(e) => setNewAdMin(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1">
                      Max (NIM)
                    </label>
                    <input
                      type="number"
                      required
                      value={newAdMax}
                      onChange={(e) => setNewAdMax(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">
                    {t('p2p.paymentMethods')} ({region?.countryName})
                  </label>
                  <div className="space-y-1.5">
                    {methods.map((pm) => {
                      const checked = newAdPmIds.includes(pm.id);
                      return (
                        <label
                          key={pm.id}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-navy-950 border border-slate-800 cursor-pointer text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setNewAdPmIds((prev) => [...prev, pm.id]);
                                } else {
                                  setNewAdPmIds((prev) =>
                                    prev.filter((id) => id !== pm.id)
                                  );
                                }
                              }}
                              className="accent-gold-500"
                            />
                            <span className="text-white font-medium">
                              {pm.providerName}
                            </span>
                          </div>
                          <span className="font-mono text-slate-400">
                            {pm.accountNumberMasked}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={postingAd || newAdPmIds.length === 0}
                  className="w-full min-h-[46px] rounded-xl bg-gold-500 text-navy-950 font-bold text-xs disabled:opacity-45"
                >
                  {postingAd ? t('common.loading') : t('profile.postNewAdBtn')}
                </button>
              </>
            )}
          </form>
        </div>
      )}
    </div>
  );
};
