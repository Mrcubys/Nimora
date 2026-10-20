import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Wallet,
  Search,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Globe,
  Key,
} from 'lucide-react';
import {
  getWalletAccount,
  signChallengeMessage,
  getWalletBalanceNim,
} from '../lib/nimiq/sdk.ts';
import {
  useAppStore,
  apiFetch,
  UserProfile,
} from '../store/useAppStore.ts';
import {
  COUNTRY_LANGUAGE_MAP,
  SUPPORTED_REGIONS,
  RegionConfig,
} from '../../packages/shared/index.ts';
import { AVAILABLE_LANGUAGES } from '../i18n/index.ts';

export const AuthPage: React.FC = () => {
  const navigate = useNavigate();
  const { setSession, syncWalletBalance, syncMarketRates } = useAppStore();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Admin Demo Gateway State
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminPass, setAdminPass] = useState('');
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);

  const handleAdminDemoLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminBusy(true);
    setAdminError(null);
    try {
      const res = await apiFetch<{
        token: string;
        adminToken: string;
        user: UserProfile;
        wallet: { address: string; balanceNim: number };
      }>('/api/demo/NIMORA/test', {
        method: 'POST',
        body: JSON.stringify({ password: adminPass.trim() }),
      });

      // Save admin session & simulated flags
      sessionStorage.setItem('nimora_admin_session_token_v1', res.adminToken);
      localStorage.setItem('nimora_demo_mode', 'true');
      localStorage.setItem('nimora_simulated_balance_nim', String(res.wallet.balanceNim));

      setSession({
        token: res.token,
        user: res.user,
        initialBalanceNim: res.wallet.balanceNim,
      });

      await Promise.all([syncWalletBalance(), syncMarketRates()]);
      navigate('/?demo=activated', { replace: true });
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'Admin demo login failed');
    } finally {
      setAdminBusy(false);
    }
  };

  const handleConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const account = await getWalletAccount();

      // 1. Request cryptographic nonce challenge
      const challenge = await apiFetch<{
        nonce: string;
        message: string;
      }>('/api/auth/challenge', {
        method: 'POST',
        body: JSON.stringify({ address: account.address }),
      });

      // 2. Sign challenge message via Nimiq Pay SDK
      const signed = await signChallengeMessage(challenge.message);

      // 3. Verify and issue JWT session
      const verified = await apiFetch<{
        token: string;
        user: UserProfile;
        escrowAddress?: string;
      }>('/api/auth/verify', {
        method: 'POST',
        body: JSON.stringify({
          address: account.address,
          nonce: challenge.nonce,
          signature: signed.signature,
          publicKey: signed.publicKey,
        }),
      });

      // 4. Query real wallet balance immediately on connect
      const liveBalance = await getWalletBalanceNim(verified.user.address);

      setSession({
        token: verified.token,
        user: verified.user,
        escrowAddress: verified.escrowAddress,
        initialBalanceNim: liveBalance,
      });

      await Promise.all([syncWalletBalance(), syncMarketRates()]);

      if (!verified.user.onboardedAt) {
        navigate('/onboarding', { replace: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-950 text-slate-100 flex flex-col justify-center items-center px-6">
      <div className="w-full max-w-sm text-center space-y-8">
        <div className="space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-navy-950 font-black text-3xl font-display shadow-xl shadow-gold-500/20 mx-auto">
            N
          </div>
          <h1 className="text-2xl font-extrabold text-white font-display tracking-tight">
            Welcome to Nimora
          </h1>
          <p className="text-xs text-slate-400">
            P2P Escrow & Payment Requests
          </p>
        </div>

        {/* Primary Admin / Demo Password Login (Instant Testing Access) */}
        <div className="bg-[#0b101c] border border-amber-500/40 rounded-3xl p-6 shadow-xl text-left space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 font-black text-sm">
                <Lock className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Admin Demo Testing</h2>
                <div className="text-[10px] text-amber-400 font-mono">Simulated Wallet (250,000 $NIM)</div>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-semibold">
              SANDBOX
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Enter administrator password to test with a pre-funded simulated wallet. No Nimiq Pay app required!
          </p>

          {adminError && (
            <div className="rounded-xl bg-red-950/70 border border-red-500/50 p-2.5 text-xs text-red-200">
              {adminError}
            </div>
          )}

          <form onSubmit={handleAdminDemoLogin} className="space-y-3">
            <div>
              <input
                type="password"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                placeholder="Enter admin password (@Raffathoriq010228)"
                required
                className="w-full h-12 px-3.5 rounded-xl bg-navy-950 border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-amber-400 font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={adminBusy || !adminPass.trim()}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-300 hover:to-amber-400 text-slate-950 font-extrabold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Key className="w-4 h-4" />
              <span>{adminBusy ? 'Unlocking Demo…' : 'Log In as Admin (Simulated Wallet)'}</span>
            </button>
          </form>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <div className="flex-1 h-px bg-slate-800" />
          <span>or connect wallet</span>
          <div className="flex-1 h-px bg-slate-800" />
        </div>

        {error && (
          <div className="rounded-xl bg-red-950/60 border border-red-500/40 p-3.5 text-xs text-red-200 flex items-start gap-2 text-start">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Nimiq Pay Connect Button */}
        <button
          type="button"
          disabled={busy}
          onClick={handleConnect}
          className="w-full min-h-[48px] rounded-2xl bg-navy-900 border border-slate-800 hover:border-slate-700 text-slate-300 font-medium text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50"
        >
          <Wallet className="w-4 h-4 text-slate-400" />
          <span>{busy ? 'Connecting…' : 'Connect via Nimiq Pay App'}</span>
        </button>

        <div className="text-[11px] text-slate-500 text-center font-mono">
          Testing endpoint: /api/demo/NIMORA/test
        </div>
      </div>
    </div>
  );
};

export const OnboardingPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token, user, updateUser, setLocale, syncMarketRates, syncWalletBalance } =
    useAppStore();

  const regionsList: RegionConfig[] = Object.values(SUPPORTED_REGIONS);
  const [search, setSearch] = useState('');
  const [realName, setRealName] = useState(user?.realName || '');
  const [selectedCountry, setSelectedCountry] = useState<string>(
    user?.country || 'ID'
  );
  const [selectedLocale, setSelectedLocale] = useState<string>(
    user?.locale || 'id'
  );
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token || !user) {
    return (
      <div className="min-h-screen bg-navy-950 text-slate-100 flex flex-col justify-center items-center px-6">
        <div className="w-full max-w-sm text-center space-y-5">
          <p className="text-sm text-slate-300">
            Please sign in with your wallet first.
          </p>
          <button
            type="button"
            onClick={() => navigate('/auth', { replace: true })}
            className="w-full min-h-[48px] rounded-xl bg-gold-500 text-navy-950 font-bold text-sm"
          >
            Go to Sign In
          </button>
        </div>
      </div>
    );
  }

  // Automatically synchronize the UI language whenever the user picks a country/region
  const handleSelectCountry = (countryCode: string) => {
    setSelectedCountry(countryCode);
    const mappedLang =
      COUNTRY_LANGUAGE_MAP[countryCode] ||
      SUPPORTED_REGIONS[countryCode]?.defaultLocale ||
      'en';
    setSelectedLocale(mappedLang);
    setLocale(mappedLang);
  };

  const handleSelectLanguage = (localeCode: string) => {
    setSelectedLocale(localeCode);
    setLocale(localeCode);
  };

  const filteredCountries = regionsList.filter(
    (c) =>
      c.countryName.toLowerCase().includes(search.toLowerCase()) ||
      c.currency.toLowerCase().includes(search.toLowerCase()) ||
      c.country.toLowerCase().includes(search.toLowerCase())
  );

  const activeCountryObj =
    SUPPORTED_REGIONS[selectedCountry] || SUPPORTED_REGIONS.ID;

  const handleConfirmLock = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch<{ user: UserProfile }>('/api/users/onboard', {
        method: 'POST',
        body: JSON.stringify({
          realName: realName.trim(),
          country: selectedCountry,
          locale: selectedLocale,
          confirmedImmutable: true,
        }),
      });
      updateUser(res.user);
      setLocale(res.user.locale);
      await Promise.all([syncMarketRates(), syncWalletBalance()]);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onboarding failed');
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-navy-950 text-slate-100 flex flex-col justify-center items-center px-4 py-10">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center space-y-1.5">
          <h1 className="text-2xl font-extrabold text-white font-display">
            {t('onboarding.title', 'Profile Setup')}
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
            {t(
              'onboarding.subtitle',
              'Enter your Real Name and select your Country to configure your local currency and payment methods.'
            )}
          </p>
        </div>

        <div className="rounded-3xl bg-navy-900 border border-slate-800 p-6 space-y-5 shadow-2xl">
          {error && (
            <div className="rounded-xl bg-red-950/60 border border-red-500/40 p-3 text-xs text-red-200">
              {error}
            </div>
          )}

          {/* 1. Real Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-200 mb-1.5">
              {t('onboarding.realNameLabel', 'Real Name')}
            </label>
            <input
              type="text"
              value={realName}
              onChange={(e) => setRealName(e.target.value)}
              placeholder={t(
                'onboarding.realNamePlaceholder',
                'Enter your full legal name'
              )}
              className="w-full h-12 px-4 rounded-xl bg-navy-950 border border-slate-800 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-gold-500"
            />
            <p className="text-[11px] text-slate-400 mt-1.5">
              {t(
                'onboarding.realNameHint',
                'Must match the account holder name on your bank or e-wallet.'
              )}
            </p>
          </div>

          {/* 2. Country */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-200">
                {t('onboarding.countryLabel', 'Country')}
              </label>
              {activeCountryObj && (
                <span className="text-xs font-mono text-gold-400">
                  {activeCountryObj.flag} {activeCountryObj.countryName} ·{' '}
                  {activeCountryObj.currency}
                </span>
              )}
            </div>

            <div className="relative mb-2.5">
              <Search className="w-4 h-4 text-slate-500 absolute start-3.5 top-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t(
                  'onboarding.searchCountry',
                  'Search country or currency…'
                )}
                className="w-full h-10 ps-10 pe-4 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-gold-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {filteredCountries.map((c) => {
                const isSelected = c.country === selectedCountry;
                return (
                  <button
                    key={c.country}
                    type="button"
                    onClick={() => handleSelectCountry(c.country)}
                    className={`min-h-[50px] p-3 rounded-xl border text-start flex items-center justify-between transition-all ${
                      isSelected
                        ? 'bg-gold-500/15 border-gold-500 text-white'
                        : 'bg-navy-950 border-slate-800/90 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xl shrink-0">{c.flag}</span>
                      <div className="truncate">
                        <div className="text-xs font-bold truncate">
                          {c.countryName}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {c.currency} ({c.currencySymbol})
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-gold-400 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. Language */}
          <div className="pt-2 border-t border-slate-800/80">
            <label className="block text-xs font-semibold text-slate-200 mb-1.5 flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-gold-400" />
              <span>{t('profile.languageLabel', 'Language')}</span>
            </label>
            <select
              value={selectedLocale}
              onChange={(e) => handleSelectLanguage(e.target.value)}
              className="w-full h-11 px-3.5 rounded-xl bg-navy-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-gold-500"
            >
              {AVAILABLE_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label} ({lang.native})
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            disabled={realName.trim().length < 2 || !selectedCountry}
            onClick={() => setConfirmOpen(true)}
            className="w-full min-h-[50px] rounded-2xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-bold text-sm shadow-lg shadow-gold-500/15 disabled:opacity-40 transition-all"
          >
            {t('onboarding.lockSubmitBtn', 'Save & Continue')}
          </button>
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-navy-900 border border-slate-800 rounded-3xl p-6 w-full max-w-md space-y-5 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white font-display">
                  {t('onboarding.confirmModalTitle', 'Confirm Your Profile')}
                </h3>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {t(
                'onboarding.confirmModalDesc',
                'Please verify your details below. Your Real Name and Country are permanently locked once confirmed.'
              )}
            </p>

            <div className="rounded-2xl bg-navy-950 border border-slate-800 p-4 space-y-2.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">
                  {t('onboarding.realNameLabel', 'Real Name')}
                </span>
                <span className="font-bold text-white">{realName.trim()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">
                  {t('onboarding.countryLabel', 'Country')}
                </span>
                <span className="font-bold text-gold-400">
                  {activeCountryObj.flag} {activeCountryObj.countryName} (
                  {activeCountryObj.currency})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">
                  {t('profile.languageLabel', 'Language')}
                </span>
                <span className="font-mono text-slate-200">
                  {AVAILABLE_LANGUAGES.find((l) => l.code === selectedLocale)
                    ?.native || selectedLocale.toUpperCase()}
                </span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setConfirmOpen(false)}
                className="flex-1 min-h-[46px] rounded-xl bg-slate-800/80 hover:bg-slate-800 text-xs font-semibold text-slate-300"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleConfirmLock}
                className="flex-1 min-h-[46px] rounded-xl bg-gradient-to-r from-gold-500 to-gold-600 text-navy-950 font-bold text-xs"
              >
                {submitting
                  ? t('common.loading', 'Loading…')
                  : t('onboarding.confirmLockYes', 'Confirm & Lock')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
