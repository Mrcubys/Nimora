import React, { useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Link,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Home,
  ArrowLeftRight,
  Gift,
  ScanLine,
  User,
  Wallet,
} from 'lucide-react';
import './i18n/index.ts';
import { useAppStore, apiFetch } from './store/useAppStore.ts';
import { AuthPage, OnboardingPage } from './pages/AuthAndOnboarding.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { P2PMarketPage } from './pages/P2PMarketPage.tsx';
import { P2POrderDetailPage } from './pages/P2POrderDetailPage.tsx';
import {
  RequestNimPage,
  PayRequestPage,
  RedPacketPage,
  ClaimRedPacketPage,
} from './pages/RequestAndRedPacketPages.tsx';
import {
  ScanQRPage,
  HistoryPage,
  ProfilePage,
} from './pages/ScanHistoryProfilePages.tsx';
import { SecretAdminPanelPage } from './pages/SecretAdminPanelPage.tsx';
import { CountryListItem, RegionConfig } from '../packages/shared/index.ts';
import { formatNim } from './lib/nimiq/units.ts';
import { adjustMockBalanceNim } from './lib/nimiq/sdk.ts';

const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    token,
    user,
    walletBalanceNim,
    theme,
    setRegionsCatalog,
    syncWalletBalance,
    syncMarketRates,
  } = useAppStore();

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    apiFetch<{
      countries: CountryListItem[];
      supportedRegions: Record<string, RegionConfig>;
      escrowAddress: string;
    }>('/api/regions')
      .then((res) => {
        setRegionsCatalog(
          res.countries,
          res.supportedRegions,
          res.escrowAddress
        );
      })
      .catch(() => {});

    syncWalletBalance();
    syncMarketRates();

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (
          data.event === 'WALLET_BALANCE_UPDATED' ||
          data.event === 'ORDER_UPDATED' ||
          data.event === 'REDPACKET_UPDATED' ||
          data.event === 'SOCIAL_TRANSFER_COMPLETED' ||
          data.event === 'CASHBACK_CLAIM_CONFIRMED'
        ) {
          if (data.event === 'WALLET_BALANCE_UPDATED') {
            const p = data.payload || data;
            const currentU = useAppStore.getState().user;
            if (p.userId === currentU?.id || p.address === currentU?.address) {
              if (typeof p.newBalanceNim === 'number') {
                useAppStore.setState((s) => ({
                  walletBalanceNim: p.newBalanceNim,
                  walletBalanceSynced: true,
                  user: s.user ? { ...s.user, balanceNim: p.newBalanceNim } : null,
                }));
                if (currentU?.address) {
                  adjustMockBalanceNim(currentU.address, 0);
                }
                return;
              }
            }
          }
          syncWalletBalance();
        }
      } catch {
        // Ignore
      }
    };

    const interval = setInterval(() => {
      syncWalletBalance();
      syncMarketRates();
    }, 15_000);

    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [setRegionsCatalog, syncWalletBalance, syncMarketRates]);

  if (!token || !user) {
    return <Navigate to="/auth" replace />;
  }

  if (!user.onboardedAt || !user.realName || !user.country) {
    return <Navigate to="/onboarding" replace />;
  }

  const locale = user.locale || 'en';
  const isActive = (path: string) =>
    path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(path);

  return (
    <div className="min-h-screen bg-navy-950 text-slate-100 flex flex-col pb-20 md:pb-8 transition-colors duration-200">
      {/* Strict 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-30 h-14 bg-navy-900/90 backdrop-blur-md border-b border-slate-800 px-4 md:px-8 flex items-center justify-between gap-6">
        {/* Zone 1: Brand Wordmark */}
        <Link
          to="/"
          className="text-lg font-extrabold tracking-tight text-gold-400 font-display whitespace-nowrap shrink-0"
        >
          Nimora
        </Link>

        {/* Zone 2: 5 concise single-line text navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-300">
          <Link
            to="/"
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              isActive('/') ? 'text-gold-400 font-bold underline underline-offset-4' : ''
            }`}
          >
            {t('nav.home')}
          </Link>
          <Link
            to="/p2p"
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              isActive('/p2p') ? 'text-gold-400 font-bold underline underline-offset-4' : ''
            }`}
          >
            {t('nav.p2p')}
          </Link>
          <Link
            to="/request"
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              isActive('/request') ? 'text-gold-400 font-bold underline underline-offset-4' : ''
            }`}
          >
            {t('nav.request')}
          </Link>
          <Link
            to="/redpacket"
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              isActive('/redpacket') ? 'text-gold-400 font-bold underline underline-offset-4' : ''
            }`}
          >
            {t('nav.redpacket')}
          </Link>
          <Link
            to="/history"
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 ${
              isActive('/history') ? 'text-gold-400 font-bold underline underline-offset-4' : ''
            }`}
          >
            {t('nav.history')}
          </Link>
        </nav>

        {/* Zone 3: Live Connected Wallet Balance + Profile Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          {localStorage.getItem('nimora_demo_mode') === 'true' && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-bold font-mono tracking-wide">
              🧪 DEMO WALLET
            </span>
          )}
          <button
            type="button"
            onClick={() => navigate('/profile')}
            className="min-h-[38px] px-3.5 rounded-xl bg-navy-950 border border-slate-800 hover:border-gold-500/50 text-xs font-semibold text-white flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
          >
            <Wallet className="w-3.5 h-3.5 text-gold-400" />
            <span className="font-mono font-bold text-gold-400 tabular-nums">
              {formatNim(walletBalanceNim, locale)}
            </span>
            <span className="text-slate-500" aria-hidden="true">|</span>
            <span>
              {user.realName} ({user.country})
            </span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 md:px-8 py-6">
        {children}
      </main>

      {/* Mobile Fixed Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-navy-900/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-5 items-center h-16 pb-safe">
        <Link
          to="/"
          className={`min-h-[44px] flex flex-col items-center justify-center ${
            isActive('/') ? 'text-gold-400' : 'text-slate-400'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
            {t('nav.home')}
          </span>
        </Link>

        <Link
          to="/p2p"
          className={`min-h-[44px] flex flex-col items-center justify-center ${
            isActive('/p2p') ? 'text-gold-400' : 'text-slate-400'
          }`}
        >
          <ArrowLeftRight className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
            {t('nav.p2p')}
          </span>
        </Link>

        <Link
          to="/scan"
          className={`min-h-[44px] flex flex-col items-center justify-center ${
            isActive('/scan') ? 'text-gold-400' : 'text-slate-400'
          }`}
        >
          <ScanLine className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
            {t('nav.scan')}
          </span>
        </Link>

        <Link
          to="/redpacket"
          className={`min-h-[44px] flex flex-col items-center justify-center ${
            isActive('/redpacket') ? 'text-gold-400' : 'text-slate-400'
          }`}
        >
          <Gift className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
            {t('nav.redpacket')}
          </span>
        </Link>

        <Link
          to="/profile"
          className={`min-h-[44px] flex flex-col items-center justify-center ${
            isActive('/profile') ? 'text-gold-400' : 'text-slate-400'
          }`}
        >
          <User className="w-5 h-5" />
          <span className="text-[10px] font-medium tracking-tight mt-1 whitespace-nowrap">
            {t('nav.profile')}
          </span>
        </Link>
      </nav>
    </div>
  );
};

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Dedicated Secret Admin Panel Route */}
        <Route
          path="/api/300210/2026/nimora/panel/only/admin"
          element={<SecretAdminPanelPage />}
        />
        <Route
          path="/admin"
          element={<SecretAdminPanelPage />}
        />
        <Route
          path="/admin-panel"
          element={<SecretAdminPanelPage />}
        />

        {/* Public Auth & Onboarding Routes */}
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />

        {/* Protected Mini App Routes */}
        <Route
          path="/"
          element={
            <AppShell>
              <HomePage />
            </AppShell>
          }
        />
        <Route
          path="/p2p"
          element={
            <AppShell>
              <P2PMarketPage />
            </AppShell>
          }
        />
        <Route
          path="/p2p/orders/:id"
          element={
            <AppShell>
              <P2POrderDetailPage />
            </AppShell>
          }
        />
        <Route
          path="/request"
          element={
            <AppShell>
              <RequestNimPage />
            </AppShell>
          }
        />
        <Route
          path="/r/:slug"
          element={
            <AppShell>
              <PayRequestPage />
            </AppShell>
          }
        />
        <Route
          path="/request/pay/:slug"
          element={
            <AppShell>
              <PayRequestPage />
            </AppShell>
          }
        />
        <Route
          path="/redpacket"
          element={
            <AppShell>
              <RedPacketPage />
            </AppShell>
          }
        />
        <Route
          path="/rp/:slug"
          element={
            <AppShell>
              <ClaimRedPacketPage />
            </AppShell>
          }
        />
        <Route
          path="/redpacket/claim/:slug"
          element={
            <AppShell>
              <ClaimRedPacketPage />
            </AppShell>
          }
        />
        <Route
          path="/scan"
          element={
            <AppShell>
              <ScanQRPage />
            </AppShell>
          }
        />
        <Route
          path="/history"
          element={
            <AppShell>
              <HistoryPage />
            </AppShell>
          }
        />
        <Route
          path="/profile"
          element={
            <AppShell>
              <ProfilePage />
            </AppShell>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
