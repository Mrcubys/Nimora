import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Zap,
  Shield,
  Filter,
  ArrowRight,
  Clock,
  CheckCircle2,
  X,
} from 'lucide-react';
import { useAppStore, apiFetch } from '../store/useAppStore.ts';
import { formatNim, formatFiat } from '../lib/nimiq/units.ts';
import { SUPPORTED_REGIONS, P2POrderStatus } from '../../packages/shared/index.ts';
import { CountdownTimer } from '../components/ui/CoreComponents.tsx';

interface P2PAd {
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
}

interface UserPaymentMethod {
  id: string;
  providerCode: string;
  providerName: string;
  type: 'BANK' | 'EWALLET';
  accountName: string;
  accountNumberMasked: string;
}

interface OrderItem {
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
  depositDeadline: string;
  paymentDeadline: string | null;
  confirmDeadline: string | null;
  createdAt: string;
}

export const P2PMarketPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAppStore();

  const initialTab = searchParams.get('tab') === 'orders' ? 'ORDERS' : 'MARKET';
  const [mainTab, setMainTab] = useState<'MARKET' | 'ORDERS'>(initialTab);
  // If user wants to BUY NIM, they browse SELL_NIM ads
  const [marketSide, setMarketSide] = useState<'BUY_NIM_VIEW' | 'SELL_NIM_VIEW'>(
    searchParams.get('side') === 'BUY_NIM' ? 'SELL_NIM_VIEW' : 'BUY_NIM_VIEW'
  );

  const [ads, setAds] = useState<P2PAd[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [myMethods, setMyMethods] = useState<UserPaymentMethod[]>([]);
  const [filterProvider, setFilterProvider] = useState<string>('');
  const [filterAmount, setFilterAmount] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected Ad Match Modal
  const [selectedAd, setSelectedAd] = useState<P2PAd | null>(null);
  const [orderAmountNim, setOrderAmountNim] = useState<string>('1000');
  const [selectedPmId, setSelectedPmId] = useState<string>('');
  const [creatingOrder, setCreatingOrder] = useState(false);

  // Fast Mode Modal
  const [fastModalOpen, setFastModalOpen] = useState(false);
  const [fastSide, setFastSide] = useState<'BUY_NIM' | 'SELL_NIM'>('BUY_NIM');
  const [fastAmount, setFastAmount] = useState<string>('1000');
  const [fastProvider, setFastProvider] = useState<string>('');
  const [fastPreview, setFastPreview] = useState<{
    ad: P2PAd;
    amountNim: number;
    fiatAmount: number;
    priceLockExpiresAt: string;
  } | null>(null);

  const region = user?.country ? SUPPORTED_REGIONS[user.country] : SUPPORTED_REGIONS.ID;
  const locale = user?.locale || 'en';

  const loadData = async () => {
    setLoading(true);
    try {
      const adSideQuery = marketSide === 'BUY_NIM_VIEW' ? 'SELL_NIM' : 'BUY_NIM';
      const params = new URLSearchParams({ side: adSideQuery });
      if (filterProvider) params.set('providerCode', filterProvider);
      if (filterAmount) params.set('amountNim', filterAmount);

      const [adsRes, ordersRes, pmRes] = await Promise.all([
        apiFetch<{ ads: P2PAd[] }>(`/api/p2p/ads?${params.toString()}`),
        apiFetch<{ orders: OrderItem[] }>('/api/p2p/orders'),
        apiFetch<{ paymentMethods: UserPaymentMethod[] }>('/api/payment-methods'),
      ]);

      setAds(adsRes.ads);
      setOrders(ordersRes.orders);
      setMyMethods(pmRes.paymentMethods);
      if (region && region.paymentMethods.length > 0 && !fastProvider) {
        setFastProvider(region.paymentMethods[0].code);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load P2P marketplace');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [marketSide, filterProvider, filterAmount]);

  const handleCreateOrderFromAd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAd) return;
    setCreatingOrder(true);
    setError(null);
    try {
      const pmIdToUse =
        selectedPmId || selectedAd.paymentMethodIds[0] || myMethods[0]?.id || 'default';
      const res = await apiFetch<{ order: { id: string } }>('/api/p2p/orders', {
        method: 'POST',
        body: JSON.stringify({
          adId: selectedAd.id,
          amountNim: Number(orderAmountNim),
          paymentMethodId: pmIdToUse,
        }),
      });
      setSelectedAd(null);
      navigate(`/p2p/orders/${res.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create order');
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleFastPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await apiFetch<{
        ad: P2PAd;
        amountNim: number;
        fiatAmount: number;
        priceLockExpiresAt: string;
      }>('/api/p2p/fast-match', {
        method: 'POST',
        body: JSON.stringify({
          side: fastSide,
          amountNim: Number(fastAmount),
          providerCode: fastProvider,
        }),
      });
      setFastPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No Fast Match available');
    }
  };

  const handleConfirmFastMatch = async () => {
    if (!fastPreview) return;
    setCreatingOrder(true);
    try {
      const res = await apiFetch<{ order: { id: string } }>('/api/p2p/orders', {
        method: 'POST',
        body: JSON.stringify({
          adId: fastPreview.ad.id,
          amountNim: fastPreview.amountNim,
          paymentMethodId: fastPreview.ad.paymentMethodIds[0],
        }),
      });
      setFastModalOpen(false);
      setFastPreview(null);
      navigate(`/p2p/orders/${res.order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fast match failed');
    } finally {
      setCreatingOrder(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header & Fast Mode Action (Posting Ads moved to Profile Menu) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-gold-400 flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            <span>
              {region?.flag} {region?.countryName} ({region?.currency}) ·{' '}
              {t('p2p.sameCountryNotice')}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white font-display mt-0.5">
            {t('p2p.title')}
          </h1>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              setFastPreview(null);
              setFastModalOpen(true);
            }}
            className="min-h-[44px] px-4 rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-bold text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0 hover:brightness-105"
          >
            <Zap className="w-4 h-4" />
            <span>{t('p2p.fastModeBtn')}</span>
          </button>
        </div>
      </div>

      {/* Primary Segmented Control: Orderbook / My Orders */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 bg-navy-900 border border-slate-800 rounded-xl w-fit">
          <button
            type="button"
            onClick={() => setMainTab('MARKET')}
            className={`min-h-[40px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              mainTab === 'MARKET'
                ? 'bg-gold-500 text-navy-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            Orderbook
          </button>
          <button
            type="button"
            onClick={() => setMainTab('ORDERS')}
            className={`min-h-[40px] px-4 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              mainTab === 'ORDERS'
                ? 'bg-gold-500 text-navy-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {t('p2p.myOrdersTab')} ({orders.length})
          </button>
        </div>

        <button
          type="button"
          onClick={() => navigate('/profile?section=ads')}
          className="text-xs font-medium text-slate-400 hover:text-gold-400 transition-colors"
        >
          Manage or Post Ads in Profile →
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-red-950/50 border border-red-500/40 p-3.5 text-xs text-red-200 flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-300 hover:text-white ms-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {mainTab === 'MARKET' && (
        <div className="space-y-4">
          {/* Buy / Sell Toggle + Country Payment Filter */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-navy-900 border border-slate-800 rounded-2xl p-3.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMarketSide('BUY_NIM_VIEW')}
                className={`min-h-[42px] px-5 rounded-xl text-xs font-bold transition-colors ${
                  marketSide === 'BUY_NIM_VIEW'
                    ? 'bg-emerald-500 text-navy-950'
                    : 'bg-navy-950 text-slate-300 hover:text-white'
                }`}
              >
                {t('p2p.buyTab')}
              </button>
              <button
                type="button"
                onClick={() => setMarketSide('SELL_NIM_VIEW')}
                className={`min-h-[42px] px-5 rounded-xl text-xs font-bold transition-colors ${
                  marketSide === 'SELL_NIM_VIEW'
                    ? 'bg-gold-500 text-navy-950'
                    : 'bg-navy-950 text-slate-300 hover:text-white'
                }`}
              >
                {t('p2p.sellTab')}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <div className="flex items-center gap-2 bg-navy-950 border border-slate-800 rounded-xl px-3 h-10">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={filterProvider}
                  onChange={(e) => setFilterProvider(e.target.value)}
                  className="bg-transparent text-xs text-slate-200 focus:outline-none"
                >
                  <option value="" className="bg-navy-900">
                    All {region?.countryName} Banks & E-Wallets
                  </option>
                  {region?.paymentMethods.map((pm) => (
                    <option key={pm.code} value={pm.code} className="bg-navy-900">
                      {pm.name} ({pm.type})
                    </option>
                  ))}
                </select>
              </div>

              <input
                type="number"
                value={filterAmount}
                onChange={(e) => setFilterAmount(e.target.value)}
                placeholder="Filter NIM amount…"
                className="h-10 px-3 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 w-40 focus:outline-none focus:border-gold-500"
              />
            </div>
          </div>

          {/* Ad List */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((n) => (
                <div
                  key={n}
                  className="h-32 rounded-2xl bg-navy-900 border border-slate-800 animate-pulse"
                />
              ))}
            </div>
          ) : ads.length === 0 ? (
            <div className="rounded-2xl bg-navy-900/60 border border-slate-800 p-8 text-center">
              <div className="text-sm font-bold text-white">
                No matching P2P advertisements in {region?.countryName}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Try clearing filters or post your own local {region?.currency} advertisement from your Profile menu.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {ads.map((ad) => (
                <div
                  key={ad.id}
                  className="rounded-2xl bg-navy-900 border border-slate-800 p-5 flex flex-col justify-between space-y-4 hover:border-slate-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-bold text-white flex items-center gap-2">
                        <span>{ad.userRealName}</span>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 tabular-nums">
                        {ad.userCompletedTrades} trades · {ad.userCompletionRate}% completion
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="text-xs text-slate-400">Unit Price</div>
                      <div className="text-lg font-extrabold text-gold-400 font-mono tabular-nums">
                        {formatFiat(ad.price, ad.fiatCurrency, locale)}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs border-t border-slate-800/80 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Available Escrow Liquidity</span>
                      <span className="font-mono text-white tabular-nums">
                        {formatNim(ad.availableNim, locale)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Order Limits</span>
                      <span className="font-mono text-slate-200 tabular-nums">
                        {ad.minAmountNim.toLocaleString()} – {ad.maxAmountNim.toLocaleString()} NIM
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-slate-400">Payment Methods</span>
                      <span className="text-slate-200 font-medium">
                        {ad.paymentMethodProviders.map((p) => p.name).join(' · ')}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAd(ad);
                      setOrderAmountNim(String(Math.max(ad.minAmountNim, 1000)));
                      setSelectedPmId(ad.paymentMethodIds[0] || '');
                    }}
                    className={`w-full min-h-[44px] rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all ${
                      marketSide === 'BUY_NIM_VIEW'
                        ? 'bg-emerald-500 hover:bg-emerald-400 text-navy-950'
                        : 'bg-gold-500 hover:bg-gold-400 text-navy-950'
                    }`}
                  >
                    <span>
                      {marketSide === 'BUY_NIM_VIEW' ? 'Buy NIM' : 'Sell NIM'} with{' '}
                      {ad.userRealName.split(' ')[0]}
                    </span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mainTab === 'ORDERS' && (
        <div className="space-y-3">
          {orders.length === 0 ? (
            <div className="rounded-2xl bg-navy-900 border border-slate-800 p-8 text-center">
              <div className="text-sm font-bold text-white">No P2P orders yet</div>
              <p className="text-xs text-slate-400 mt-1">
                Match an advertisement in the Orderbook or use Fast Mode to start trading.
              </p>
            </div>
          ) : (
            orders.map((ord) => {
              const isBuyer = ord.buyerId === user?.id;
              const deadline =
                ord.status === 'AWAITING_DEPOSIT'
                  ? ord.depositDeadline
                  : ord.status === 'PAYMENT_SUBMITTED'
                  ? ord.confirmDeadline
                  : ord.paymentDeadline;

              return (
                <div
                  key={ord.id}
                  onClick={() => navigate(`/p2p/orders/${ord.id}`)}
                  className="cursor-pointer rounded-2xl bg-navy-900 hover:bg-navy-800/80 border border-slate-800 p-5 space-y-3 transition-all"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs text-slate-400 flex items-center gap-2">
                      <span
                        className={`font-bold ${
                          isBuyer ? 'text-emerald-400' : 'text-gold-400'
                        }`}
                      >
                        {isBuyer ? 'BUY NIM' : 'SELL NIM'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-300">#{ord.id}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Counterparty: {isBuyer ? ord.sellerName : ord.buyerName}
                      </span>
                    </div>
                    <div className="text-xs font-mono font-semibold text-white">
                      Status: {ord.status}
                      {ord.cancelReason ? ` (${ord.cancelReason})` : ''}
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="text-lg font-bold text-white font-mono tabular-nums">
                      {formatNim(ord.amountNim, locale)}
                    </div>
                    <div className="text-base font-bold text-gold-400 font-mono tabular-nums">
                      {formatFiat(ord.fiatAmount, ord.fiatCurrency, locale)}
                    </div>
                  </div>

                  {deadline &&
                    ['AWAITING_DEPOSIT', 'CRYPTO_LOCKED', 'AWAITING_PAYMENT', 'PAYMENT_SUBMITTED'].includes(
                      ord.status
                    ) && <CountdownTimer deadlineIso={deadline} />}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Modal 1: Match Ad Order Creation */}
      {selectedAd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <form
            onSubmit={handleCreateOrderFromAd}
            className="bg-navy-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white font-display">
                {selectedAd.side === 'SELL_NIM' ? 'Buy NIM' : 'Sell NIM'} ·{' '}
                {selectedAd.userRealName}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedAd(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-xl bg-navy-950 border border-slate-800 p-3.5 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">Fixed Price</span>
                <span className="font-mono font-bold text-gold-400">
                  {formatFiat(selectedAd.price, selectedAd.fiatCurrency, locale)} / NIM
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Limits</span>
                <span className="font-mono text-slate-200">
                  {selectedAd.minAmountNim} – {selectedAd.maxAmountNim} NIM
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">30m Auto-Cancel SLA</span>
                <span className="text-emerald-400 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> Enforced
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-200 mb-1.5">
                Amount of NIM
              </label>
              <input
                type="number"
                required
                min={selectedAd.minAmountNim}
                max={Math.min(selectedAd.maxAmountNim, selectedAd.availableNim)}
                value={orderAmountNim}
                onChange={(e) => setOrderAmountNim(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white font-mono focus:outline-none focus:border-gold-500"
              />
              <div className="text-xs text-slate-400 mt-1.5 flex justify-between">
                <span>Fiat Total to Settle:</span>
                <span className="font-mono font-bold text-gold-400">
                  {formatFiat(
                    Number(orderAmountNim || 0) * selectedAd.price,
                    selectedAd.fiatCurrency,
                    locale
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSelectedAd(null)}
                className="flex-1 min-h-[44px] rounded-xl border border-slate-700 text-xs font-semibold text-slate-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingOrder}
                className="flex-1 min-h-[44px] rounded-xl bg-gold-500 text-navy-950 font-bold text-xs hover:brightness-105"
              >
                {creatingOrder ? 'Matching…' : 'Open Escrow Order'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 2: Fast Mode Match (with 10-Second Price Lock Preview) */}
      {fastModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-navy-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-gold-400">
                <Zap className="w-5 h-5" />
                <h3 className="text-base font-bold text-white font-display">
                  Fast Mode Same-Country Match
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setFastModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {!fastPreview ? (
              <form onSubmit={handleFastPreview} className="space-y-4">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setFastSide('BUY_NIM')}
                    className={`min-h-[42px] rounded-xl text-xs font-bold ${
                      fastSide === 'BUY_NIM'
                        ? 'bg-emerald-500 text-navy-950'
                        : 'bg-navy-950 text-slate-300 border border-slate-800'
                    }`}
                  >
                    Buy NIM
                  </button>
                  <button
                    type="button"
                    onClick={() => setFastSide('SELL_NIM')}
                    className={`min-h-[42px] rounded-xl text-xs font-bold ${
                      fastSide === 'SELL_NIM'
                        ? 'bg-gold-500 text-navy-950'
                        : 'bg-navy-950 text-slate-300 border border-slate-800'
                    }`}
                  >
                    Sell NIM
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    Amount (NIM)
                  </label>
                  <input
                    type="number"
                    required
                    min={100}
                    value={fastAmount}
                    onChange={(e) => setFastAmount(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-200 mb-1">
                    {region?.countryName} Payment Method
                  </label>
                  <select
                    value={fastProvider}
                    onChange={(e) => setFastProvider(e.target.value)}
                    className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white"
                  >
                    {region?.paymentMethods.map((pm) => (
                      <option key={pm.code} value={pm.code}>
                        {pm.name} ({pm.type})
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  className="w-full min-h-[46px] rounded-xl bg-gold-500 text-navy-950 font-bold text-xs"
                >
                  Find Best-Priced Local Match
                </button>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl bg-navy-950 border border-gold-500/40 p-4 space-y-2.5 text-xs">
                  <div className="text-emerald-400 font-semibold">
                    Best Local Price Locked for 10 Seconds
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Matched Peer</span>
                    <span className="text-white font-bold">
                      {fastPreview.ad.userRealName} ({fastPreview.ad.userCompletionRate}%)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">NIM Amount</span>
                    <span className="font-mono text-white font-bold">
                      {formatNim(fastPreview.amountNim, locale)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Unit Price</span>
                    <span className="font-mono text-gold-400">
                      {formatFiat(fastPreview.ad.price, fastPreview.ad.fiatCurrency, locale)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-800 pt-2">
                    <span className="text-slate-300 font-semibold">Total Fiat</span>
                    <span className="font-mono text-base font-bold text-gold-400">
                      {formatFiat(fastPreview.fiatAmount, fastPreview.ad.fiatCurrency, locale)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setFastPreview(null)}
                    className="flex-1 min-h-[44px] rounded-xl border border-slate-700 text-xs text-slate-300"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={creatingOrder}
                    onClick={handleConfirmFastMatch}
                    className="flex-1 min-h-[44px] rounded-xl bg-gold-500 text-navy-950 font-bold text-xs"
                  >
                    {creatingOrder ? 'Opening Order…' : 'Confirm Match Now'}
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
