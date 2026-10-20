import React, { useEffect, useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ArrowUpRight,
  ArrowDownLeft,
  QrCode,
  Gift,
  ScanLine,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import { useAppStore, apiFetch } from '../store/useAppStore.ts';
import { formatNim, formatFiat } from '../lib/nimiq/units.ts';
import { SUPPORTED_REGIONS, P2POrderStatus } from '../../packages/shared/index.ts';
import { CountdownTimer } from '../components/ui/CoreComponents.tsx';

interface OrderSummary {
  id: string;
  sellerId: string;
  sellerName: string;
  buyerId: string;
  buyerName: string;
  amountNim: number;
  fiatAmount: number;
  fiatCurrency: string;
  status: P2POrderStatus;
  depositDeadline: string;
  paymentDeadline: string | null;
  confirmDeadline: string | null;
  createdAt: string;
}

interface BannerItem {
  id: string;
  title: string;
  subtitle: string;
  imageDataUrl: string;
  targetRoute: string;
  isActive: boolean;
  createdAt: string;
}

export const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, syncWalletBalance, theme } = useAppStore();
  const isLight = theme === 'light';
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [activeSlide, setActiveSlide] = useState(0);
  const [loading, setLoading] = useState(true);

  const sliderRef = useRef<HTMLDivElement>(null);

  const region = user?.country ? SUPPORTED_REGIONS[user.country] : SUPPORTED_REGIONS.ID;
  const locale = user?.locale || 'en';

  const fetchHomeData = async () => {
    try {
      const [ordersRes, bannersRes] = await Promise.all([
        apiFetch<{ orders: OrderSummary[] }>('/api/p2p/orders'),
        apiFetch<{ banners: BannerItem[] }>('/api/banners'),
      ]);
      setOrders(ordersRes.orders);
      setBanners(bannersRes.banners || []);
    } catch {
      // Ignore error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHomeData();
    syncWalletBalance();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.event === 'BANNERS_UPDATED' || msg.event === 'ORDER_UPDATED') {
          fetchHomeData();
          syncWalletBalance();
        }
      } catch {
        // Ignore
      }
    };

    return () => ws.close();
  }, []);

  const scrollToSlide = (index: number) => {
    if (!sliderRef.current || banners.length === 0) return;
    const bounded = (index + banners.length) % banners.length;
    setActiveSlide(bounded);
    const width = sliderRef.current.clientWidth;
    sliderRef.current.scrollTo({
      left: bounded * width,
      behavior: 'smooth',
    });
  };

  const handleBannerScroll = () => {
    if (!sliderRef.current || banners.length <= 1) return;
    const width = sliderRef.current.clientWidth;
    if (width > 0) {
      const idx = Math.round(sliderRef.current.scrollLeft / width);
      if (idx !== activeSlide && idx >= 0 && idx < banners.length) {
        setActiveSlide(idx);
      }
    }
  };

  const handleBannerClick = (targetRoute: string) => {
    const trimmed = targetRoute.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      window.location.href = trimmed;
      return;
    }
    navigate(trimmed.startsWith('/') ? trimmed : `/${trimmed}`);
  };

  const activeOrders = orders.filter((o) =>
    [
      'AWAITING_DEPOSIT',
      'CRYPTO_LOCKED',
      'AWAITING_PAYMENT',
      'PAYMENT_SUBMITTED',
      'DISPUTED',
    ].includes(o.status)
  );

  return (
    <div className="space-y-7">
      {/* 1. Admin Promotional Banner Slider (Horizontal swipeable carousel when 2+ banners exist) */}
      {banners.length > 0 && (
        <section className="relative group">
          <div
            ref={sliderRef}
            onScroll={handleBannerScroll}
            className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth rounded-2xl border border-slate-800 shadow-xl no-scrollbar"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {banners.map((banner) => (
              <div
                key={banner.id}
                onClick={() => handleBannerClick(banner.targetRoute)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleBannerClick(banner.targetRoute);
                  }
                }}
                className="w-full shrink-0 snap-center relative h-44 sm:h-52 cursor-pointer overflow-hidden bg-navy-900 select-none"
              >
                <img
                  src={banner.imageDataUrl}
                  alt={banner.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover transition-transform duration-300 hover:scale-[1.01]"
                />
                <div className={`absolute inset-0 p-5 sm:p-6 flex flex-col justify-end transition-colors ${
                  isLight
                    ? 'bg-gradient-to-t from-black/85 via-black/45 to-transparent'
                    : 'bg-gradient-to-t from-black/90 via-black/45 to-transparent'
                }`}>
                  <div className="max-w-xl">
                    <h2
                      className={`text-lg sm:text-xl font-extrabold font-display tracking-tight transition-colors drop-shadow-md ${
                        isLight ? 'text-[#E9B200]' : 'text-white'
                      }`}
                    >
                      {banner.title}
                    </h2>
                    {banner.subtitle && (
                      <p
                        className={`text-xs sm:text-sm mt-1 line-clamp-2 transition-colors drop-shadow ${
                          isLight ? 'text-[#FFD700] font-semibold' : 'text-slate-100'
                        }`}
                      >
                        {banner.subtitle}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {banners.length >= 2 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  scrollToSlide(activeSlide - 1);
                }}
                aria-label="Previous banner"
                className="hidden sm:flex absolute start-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-navy-950/80 border border-slate-700 text-white items-center justify-center hover:bg-navy-900 transition-opacity opacity-0 group-hover:opacity-100"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  scrollToSlide(activeSlide + 1);
                }}
                aria-label="Next banner"
                className="hidden sm:flex absolute end-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-navy-950/80 border border-slate-700 text-white items-center justify-center hover:bg-navy-900 transition-opacity opacity-0 group-hover:opacity-100"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <div className="flex items-center justify-center gap-2 mt-2.5">
                {banners.map((b, idx) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-label={`Slide ${idx + 1}`}
                    onClick={() => scrollToSlide(idx)}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === activeSlide
                        ? 'w-6 bg-gold-400'
                        : 'w-2 bg-slate-700 hover:bg-slate-500'
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* 2. Clean Quick Actions Grid */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-200 font-display">
            {t('home.quickActions')}
          </h2>
          {region && (
            <span className="text-xs text-slate-400">
              {region.flag} {region.countryName} · {region.currency}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <button
            type="button"
            onClick={() => navigate('/p2p?side=SELL_NIM')}
            className="min-h-[88px] rounded-2xl bg-navy-900 hover:bg-navy-800 border border-slate-800 hover:border-gold-500/50 p-4 flex flex-col justify-between text-start transition-all shadow-sm"
          >
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
            <div className="mt-2">
              <div className="text-sm font-bold text-white">{t('home.buyNim')}</div>
              <div className="text-[11px] text-slate-400">
                {t('home.buyNimSub')} ({region?.currency})
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/p2p?side=BUY_NIM')}
            className="min-h-[88px] rounded-2xl bg-navy-900 hover:bg-navy-800 border border-slate-800 hover:border-gold-500/50 p-4 flex flex-col justify-between text-start transition-all shadow-sm"
          >
            <div className="w-8 h-8 rounded-xl bg-gold-500/15 flex items-center justify-center text-gold-400">
              <ArrowUpRight className="w-4 h-4" />
            </div>
            <div className="mt-2">
              <div className="text-sm font-bold text-white">{t('home.sellNim')}</div>
              <div className="text-[11px] text-slate-400">
                {t('home.sellNimSub')} ({region?.currency})
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/request')}
            className="min-h-[88px] rounded-2xl bg-navy-900 hover:bg-navy-800 border border-slate-800 hover:border-gold-500/50 p-4 flex flex-col justify-between text-start transition-all shadow-sm"
          >
            <div className="w-8 h-8 rounded-xl bg-sky-500/15 flex items-center justify-center text-sky-400">
              <QrCode className="w-4 h-4" />
            </div>
            <div className="mt-2">
              <div className="text-sm font-bold text-white">{t('home.requestNim')}</div>
              <div className="text-[11px] text-slate-400">
                {t('home.requestNimSub')}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/redpacket')}
            className="min-h-[88px] rounded-2xl bg-navy-900 hover:bg-navy-800 border border-slate-800 hover:border-gold-500/50 p-4 flex flex-col justify-between text-start transition-all shadow-sm"
          >
            <div className="w-8 h-8 rounded-xl bg-rose-500/15 flex items-center justify-center text-rose-400">
              <Gift className="w-4 h-4" />
            </div>
            <div className="mt-2">
              <div className="text-sm font-bold text-white">
                {t('home.sendRedPacket')}
              </div>
              <div className="text-[11px] text-slate-400">
                {t('home.sendRedPacketSub')}
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate('/scan')}
            className="col-span-2 sm:col-span-1 min-h-[88px] rounded-2xl bg-gradient-to-br from-gold-500/20 to-gold-600/10 hover:from-gold-500/30 border border-gold-500/40 p-4 flex flex-col justify-between text-start transition-all shadow-sm"
          >
            <div className="w-8 h-8 rounded-xl bg-gold-500/20 flex items-center justify-center text-gold-400">
              <ScanLine className="w-4 h-4" />
            </div>
            <div className="mt-2">
              <div className="text-sm font-bold text-gold-300">{t('home.scanQr')}</div>
              <div className="text-[11px] text-slate-300">
                {t('home.scanQrSub')}
              </div>
            </div>
          </button>
        </div>
      </section>

      {/* 3. Active P2P Orders with Live 30-Minute Countdown Timers */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-slate-200 font-display">
            {t('home.activeOrders')} ({activeOrders.length})
          </h2>
          <Link
            to="/p2p?tab=orders"
            className="text-xs font-medium text-gold-400 hover:underline flex items-center gap-1"
          >
            <span>{t('home.viewAllOrders')}</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {loading ? (
          <div className="rounded-2xl bg-navy-900 border border-slate-800 p-5 animate-pulse h-24" />
        ) : activeOrders.length === 0 ? (
          <div className="rounded-2xl bg-navy-900/60 border border-slate-800/80 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-sm font-semibold text-slate-200">
                {t('home.noActiveOrders')}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {t('home.noActiveOrdersHint')}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/p2p')}
              className="min-h-[42px] px-4 rounded-xl bg-gold-500 text-navy-950 font-bold text-xs whitespace-nowrap shrink-0 hover:brightness-105"
            >
              {t('home.browseMarket')}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {activeOrders.map((ord) => {
              const isBuyer = ord.buyerId === user?.id;
              const activeDeadline =
                ord.status === 'AWAITING_DEPOSIT'
                  ? ord.depositDeadline
                  : ord.status === 'PAYMENT_SUBMITTED'
                  ? ord.confirmDeadline
                  : ord.paymentDeadline;

              return (
                <div
                  key={ord.id}
                  onClick={() => navigate(`/p2p/orders/${ord.id}`)}
                  className="cursor-pointer rounded-2xl bg-navy-900 hover:bg-navy-800/80 border border-slate-800 hover:border-gold-500/40 p-4 transition-all space-y-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-slate-400 flex items-center gap-2">
                        <span className="font-semibold text-gold-400">
                          {isBuyer ? t('home.buyingNim') : t('home.sellingNim')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {t('home.withPeer')} {isBuyer ? ord.sellerName : ord.buyerName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-slate-300">{ord.status}</span>
                      </div>
                      <div className="text-base font-bold text-white font-mono tabular-nums mt-1">
                        {formatNim(ord.amountNim, locale)} ·{' '}
                        <span className="text-gold-400">
                          {formatFiat(ord.fiatAmount, ord.fiatCurrency, locale)}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-400 shrink-0" />
                  </div>

                  {activeDeadline && ord.status !== 'DISPUTED' && (
                    <CountdownTimer
                      deadlineIso={activeDeadline}
                      label={
                        ord.status === 'AWAITING_DEPOSIT'
                          ? t('home.sellerDepositTimer')
                          : ord.status === 'PAYMENT_SUBMITTED'
                          ? t('home.sellerConfirmTimer')
                          : t('home.buyerFiatTimer')
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
