import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n, { applyDocumentLocale } from '../i18n/index.ts';
import {
  SUPPORTED_REGIONS,
  CountryListItem,
  RegionConfig,
} from '../../packages/shared/index.ts';
import { getWalletBalanceNim, adjustMockBalanceNim } from '../lib/nimiq/sdk.ts';

export interface UserProfile {
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
  twitterHandle?: string | null;
  telegramHandle?: string | null;
  telegramUserId?: string | null;
  balanceNim?: number;
}

function applyThemeClass(theme: 'dark' | 'light'): void {
  if (typeof document === 'undefined') return;
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

interface AppState {
  token: string | null;
  user: UserProfile | null;
  walletBalanceNim: number;
  walletBalanceSynced: boolean;
  balanceLoading: boolean;
  marketRates: Record<string, number>;
  marketRatesSource: string;
  sdkMode: 'native' | 'mock';
  theme: 'dark' | 'light';
  escrowAddress: string;
  countries: CountryListItem[];
  supportedRegions: Record<string, RegionConfig>;
  setAuth: (token: string, user: UserProfile) => void;
  setSession: (params: {
    token: string;
    user: UserProfile;
    escrowAddress?: string;
    initialBalanceNim?: number;
  }) => void;
  updateUser: (user: UserProfile) => void;
  logout: () => void;
  setLocale: (locale: string) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setSdkMode: (mode: 'native' | 'mock') => void;
  syncWalletBalance: () => Promise<number>;
  syncMarketRates: () => Promise<void>;
  deductSimulatedBalance: (amountNim: number) => void;
  creditSimulatedBalance: (amountNim: number) => void;
  getNimPriceForCurrency: (currency: string, fallback: number) => number;
  setRegionsCatalog: (
    countries: CountryListItem[],
    supportedRegions: Record<string, RegionConfig>,
    escrowAddress: string
  ) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      walletBalanceNim: 0,
      walletBalanceSynced: false,
      balanceLoading: false,
      marketRates: {},
      marketRatesSource: 'market_reference',
      sdkMode: 'mock',
      theme: 'dark',
      escrowAddress: 'NQ47 JQ20 R4SM 53AY 9Y9F VQKF FMJP Q6AU KURR',
      countries: [],
      supportedRegions: SUPPORTED_REGIONS,
      setAuth: (token, user) => {
        if (user.locale) {
          i18n.changeLanguage(user.locale);
          applyDocumentLocale(user.locale);
        }
        set({ token, user });
        setTimeout(() => {
          get().syncWalletBalance();
          get().syncMarketRates();
        }, 50);
      },
      setSession: ({ token, user, escrowAddress, initialBalanceNim }) => {
        if (user.locale) {
          i18n.changeLanguage(user.locale);
          applyDocumentLocale(user.locale);
        }
        set((state) => ({
          token,
          user,
          escrowAddress: escrowAddress || state.escrowAddress,
          walletBalanceNim:
            typeof initialBalanceNim === 'number'
              ? initialBalanceNim
              : state.walletBalanceNim,
          walletBalanceSynced: typeof initialBalanceNim === 'number',
        }));
        setTimeout(() => {
          get().syncWalletBalance();
          get().syncMarketRates();
        }, 50);
      },
      updateUser: (user) => {
        if (user.locale) {
          i18n.changeLanguage(user.locale);
          applyDocumentLocale(user.locale);
        }
        set({ user });
      },
      logout: () => {
        set({
          token: null,
          user: null,
          walletBalanceNim: 0,
          walletBalanceSynced: false,
        });
      },
      setLocale: (locale) => {
        i18n.changeLanguage(locale);
        applyDocumentLocale(locale);
        set((state) => ({
          user: state.user ? { ...state.user, locale } : null,
        }));
      },
      setTheme: (theme) => {
        applyThemeClass(theme);
        set({ theme });
      },
      setSdkMode: (sdkMode) => set({ sdkMode }),
      syncWalletBalance: async () => {
        const currentUser = get().user;
        if (!currentUser?.address) return 0;
        set({ balanceLoading: true });
        try {
          const liveBal = await getWalletBalanceNim(currentUser.address);
          const finalBal = Math.max(liveBal, currentUser.balanceNim || 0);
          set((state) => ({
            walletBalanceNim: finalBal,
            walletBalanceSynced: true,
            balanceLoading: false,
            user: state.user ? { ...state.user, balanceNim: finalBal } : null,
          }));
          return finalBal;
        } catch {
          set({ balanceLoading: false });
          return get().walletBalanceNim;
        }
      },
      syncMarketRates: async () => {
        try {
          const res = await fetch('/api/market-rates');
          if (res.ok) {
            const data = await res.json();
            if (data.rates && typeof data.rates === 'object') {
              set({
                marketRates: data.rates,
                marketRatesSource: data.source || 'coingecko_live',
              });
            }
          }
        } catch {
          // Ignore network error
        }
      },
      deductSimulatedBalance: (amountNim) => {
        const addr = get().user?.address;
        if (addr) {
          adjustMockBalanceNim(addr, -amountNim);
        }
        set((state) => {
          const nextBal = Math.max(
            0,
            Number((state.walletBalanceNim - amountNim).toFixed(5))
          );
          return {
            walletBalanceNim: nextBal,
            user: state.user ? { ...state.user, balanceNim: nextBal } : null,
          };
        });
      },
      creditSimulatedBalance: (amountNim) => {
        const addr = get().user?.address;
        if (addr) {
          adjustMockBalanceNim(addr, amountNim);
        }
        set((state) => {
          const nextBal = Number(
            (state.walletBalanceNim + amountNim).toFixed(5)
          );
          return {
            walletBalanceNim: nextBal,
            user: state.user ? { ...state.user, balanceNim: nextBal } : null,
          };
        });
      },
      getNimPriceForCurrency: (currency, fallback) => {
        const rates = get().marketRates;
        const rate = rates[currency.toUpperCase()];
        return typeof rate === 'number' && rate > 0 ? rate : fallback;
      },
      setRegionsCatalog: (countries, supportedRegions, escrowAddress) =>
        set({ countries, supportedRegions, escrowAddress }),
    }),
    {
      name: 'nimora-ui-preferences',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        theme: state.theme,
        walletBalanceNim: state.walletBalanceNim,
        marketRates: state.marketRates,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyThemeClass(state.theme || 'dark');
          if (state.user?.locale) {
            i18n.changeLanguage(state.user.locale);
            applyDocumentLocale(state.user.locale);
          }
        }
      },
    }
  )
);

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = useAppStore.getState().token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      useAppStore.getState().logout();
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}
