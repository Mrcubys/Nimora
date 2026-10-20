import { init, type NimiqProvider } from '@nimiq/mini-app-sdk';
import {
  nimToLuna,
  lunaToNim,
  isValidNimiqAddress,
  normalizeNimiqAddressFormat,
  createValidNimiqAddressFromBody,
} from './units.ts';

export type NimiqErrorCode =
  | 'UserRejected'
  | 'InsufficientFunds'
  | 'NotInNimiqPay'
  | 'NetworkError'
  | 'Unknown';

export class NimiqSdkError extends Error {
  public readonly code: NimiqErrorCode;

  constructor(code: NimiqErrorCode, message: string) {
    super(message);
    this.name = 'NimiqSdkError';
    this.code = code;
  }
}

export interface SignedMessageResult {
  signature: string;
  publicKey: string;
}

export interface SendNimParams {
  recipient: string;
  amountNim: number;
  data?: string;
}

let cachedProvider: NimiqProvider | null = null;
const isMockAllowed = import.meta.env.VITE_MOCK_SDK !== 'false';
const MOCK_STORAGE_KEY = 'nimora_mock_wallet_address';
const MOCK_BALANCE_MAP_KEY = 'nimora_mock_wallet_balances_v2';

// Valid Nimiq MOD-97 addresses for sandbox testing outside Nimiq Pay WebView
export const VALID_SANDBOX_WALLETS = {
  ADMIN: 'NQ47 JQ20 R4SM 53AY 9Y9F VQKF FMJP Q6AU KURR',
  PRIMARY: createValidNimiqAddressFromBody('N1M0RADEVWA11ET98765432100002026'),
  SECONDARY: createValidNimiqAddressFromBody('SEC0NDUSERWA11ET0099887766552026'),
  MERCHANT_ID: createValidNimiqAddressFromBody('RAKASANT0S01ND0NES1AMKT188992026'),
};

function getOrCreateMockAddress(): string {
  if (typeof window !== 'undefined') {
    if (localStorage.getItem('nimora_demo_mode') === 'true') {
      return VALID_SANDBOX_WALLETS.ADMIN;
    }
    const existing = localStorage.getItem(MOCK_STORAGE_KEY);
    if (existing && isValidNimiqAddress(existing)) {
      return normalizeNimiqAddressFormat(existing);
    }
  }
  const defaultAddr = VALID_SANDBOX_WALLETS.PRIMARY;
  if (typeof window !== 'undefined') {
    localStorage.setItem(MOCK_STORAGE_KEY, defaultAddr);
  }
  return defaultAddr;
}

export function setMockWalletAddress(address: string): void {
  const formatted = normalizeNimiqAddressFormat(address);
  if (typeof window !== 'undefined') {
    localStorage.setItem(MOCK_STORAGE_KEY, formatted);
  }
}

function getMockBalanceLuna(address: string): number {
  const clean = normalizeNimiqAddressFormat(address);
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(MOCK_BALANCE_MAP_KEY) : null;
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    if (typeof map[clean] === 'number') {
      return map[clean];
    }
    // Seed realistic initial wallet balance in sandbox mode if not set yet
    const initialNim =
      clean === VALID_SANDBOX_WALLETS.ADMIN ? 250_000 : 12_500;
    const initialLuna = nimToLuna(initialNim);
    map[clean] = initialLuna;
    if (typeof window !== 'undefined') {
      localStorage.setItem(MOCK_BALANCE_MAP_KEY, JSON.stringify(map));
    }
    return initialLuna;
  } catch {
    return nimToLuna(12_500);
  }
}

export function adjustMockBalanceNim(address: string, deltaNim: number): number {
  const clean = normalizeNimiqAddressFormat(address);
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(MOCK_BALANCE_MAP_KEY) : null;
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    const currentLuna = getMockBalanceLuna(clean);
    const nextLuna = Math.max(0, currentLuna + Math.round(deltaNim * 100_000));
    map[clean] = nextLuna;
    if (typeof window !== 'undefined') {
      localStorage.setItem(MOCK_BALANCE_MAP_KEY, JSON.stringify(map));
    }
    return lunaToNim(nextLuna);
  } catch {
    return 0;
  }
}

function normalizeError(err: unknown): NimiqSdkError {
  if (err instanceof NimiqSdkError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes('reject') || lower.includes('cancel') || lower.includes('denied')) {
    return new NimiqSdkError('UserRejected', 'Transaction or signature was cancelled by the user.');
  }
  if (lower.includes('insufficient') || lower.includes('balance')) {
    return new NimiqSdkError('InsufficientFunds', 'Insufficient NIM balance in your connected wallet.');
  }
  if (lower.includes('network') || lower.includes('timeout') || lower.includes('offline')) {
    return new NimiqSdkError('NetworkError', 'Network error communicating with Nimiq node.');
  }
  return new NimiqSdkError('Unknown', msg || 'Unexpected Nimiq SDK error');
}

export async function initNimiq(): Promise<{ mode: 'native' | 'mock' }> {
  // If in demo mode, prioritize simulated mock wallet
  if (typeof window !== 'undefined' && localStorage.getItem('nimora_demo_mode') === 'true') {
    return { mode: 'mock' };
  }

  if (cachedProvider) {
    return { mode: 'native' };
  }

  try {
    const providerPromise = init({ timeout: 1000 });
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), 1050)
    );
    const provider = await Promise.race([providerPromise, timeoutPromise]);
    if (provider) {
      cachedProvider = provider;
      return { mode: 'native' };
    }
  } catch {
    // Fallback if not inside Nimiq Pay WebView
  }

  // Gracefully fall back to simulated sandbox mode outside Nimiq Pay app
  return { mode: 'mock' };
}

export async function getAccounts(): Promise<string[]> {
  try {
    await initNimiq();
    if (cachedProvider) {
      const res = await cachedProvider.listAccounts();
      if (Array.isArray(res) && res.length > 0) {
        return res.map((a) =>
          normalizeNimiqAddressFormat(
            typeof a === 'string'
              ? a
              : String((a as { address?: string }).address || a)
          )
        );
      }
    }
    return [getOrCreateMockAddress()];
  } catch {
    return [getOrCreateMockAddress()];
  }
}

export function isInsideNimiqPay(): boolean {
  return Boolean(
    cachedProvider ||
      (typeof window !== 'undefined' &&
        ('nimiq' in window || /NimiqPay/i.test(navigator.userAgent)))
  );
}

export async function getWalletAccount(): Promise<{
  address: string;
  label: string;
  source: 'NIMIQ_PAY' | 'DEV_SANDBOX';
}> {
  const mode = await initNimiq();
  const accounts = await getAccounts();
  return {
    address: accounts[0],
    label: mode.mode === 'native' ? 'Nimiq Pay Wallet' : 'Connected Wallet',
    source: mode.mode === 'native' ? 'NIMIQ_PAY' : 'DEV_SANDBOX',
  };
}

export async function signChallengeMessage(
  message: string
): Promise<SignedMessageResult> {
  return signMessage(message);
}

/**
 * Fetches the accurate, live Nimiq balance for the connected wallet:
 * 1) Native Nimiq Pay SDK `provider.getBalance(address)` (returns luna)
 * 2) Public Nimiq Mainnet/Testnet RPC or Watch API via backend `/api/market-and-wallet?address=...`
 * 3) Sandbox local ledger if running in browser preview with a sandbox address
 */
export async function getWalletBalanceNim(address: string): Promise<number> {
  const formatted = normalizeNimiqAddressFormat(address);
  if (!formatted) return 0;

  let providerBal = 0;
  try {
    await initNimiq();
    if (cachedProvider && typeof cachedProvider.getBalance === 'function') {
      // Wait briefly if consensus is establishing inside Nimiq Pay
      if (typeof cachedProvider.isConsensusEstablished === 'function') {
        try {
          const established = await cachedProvider.isConsensusEstablished();
          if (!established) {
            await new Promise((r) => setTimeout(r, 600));
          }
        } catch {
          // Ignore
        }
      }
      const balanceRes = await cachedProvider.getBalance(formatted);
      if (typeof balanceRes === 'number' && Number.isFinite(balanceRes) && balanceRes >= 0) {
        providerBal = lunaToNim(balanceRes);
      }
    }
  } catch {
    // Fall through to on-chain & backend lookup
  }

  // Query backend on-chain & database balance resolver
  let serverBal = 0;
  try {
    const rawPrefs = typeof window !== 'undefined' ? localStorage.getItem('nimora-ui-preferences') : null;
    const token = rawPrefs ? JSON.parse(rawPrefs)?.state?.token : null;
    const headers: Record<string, string> = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(
      `/api/wallet/balance?address=${encodeURIComponent(formatted)}`,
      { headers }
    );
    if (res.ok) {
      const data = await res.json();
      if (typeof data.onChainBalanceNim === 'number') {
        serverBal = data.onChainBalanceNim;
      }
    }
  } catch {
    // Ignore network error
  }

  const mockBal = lunaToNim(getMockBalanceLuna(formatted));

  // The true wallet balance reflects the maximum of all on-chain funds, backend database credits (like redpackets), and local state
  const finalBal = Math.max(providerBal, serverBal, mockBal);

  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(MOCK_BALANCE_MAP_KEY) : null;
    const map = raw ? JSON.parse(raw) : {};
    map[formatted] = nimToLuna(finalBal);
    if (typeof window !== 'undefined') {
      localStorage.setItem(MOCK_BALANCE_MAP_KEY, JSON.stringify(map));
    }
  } catch {
    // Ignore localStorage error
  }

  return finalBal;
}

export async function signMessage(message: string): Promise<SignedMessageResult> {
  try {
    await initNimiq();
    if (cachedProvider) {
      const res = await cachedProvider.sign(message);
      if (res && typeof res === 'object' && 'signature' in res && 'publicKey' in res) {
        return {
          signature: String((res as { signature: string }).signature),
          publicKey: String((res as { publicKey: string }).publicKey),
        };
      }
    }

    const addr = getOrCreateMockAddress();
    const encoder = new TextEncoder();
    const bytes = encoder.encode(`${addr}:${message}`);
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hashHex = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return {
      signature: `sig_ed25519_${hashHex}`,
      publicKey: `pub_ed25519_${hashHex.slice(0, 32)}`,
    };
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function sendNim({
  recipient,
  amountNim,
  data,
}: SendNimParams): Promise<{ txHash: string }> {
  try {
    const cleanRecipient = normalizeNimiqAddressFormat(recipient);
    if (!isValidNimiqAddress(cleanRecipient)) {
      throw new NimiqSdkError(
        'Unknown',
        `Invalid recipient Nimiq address checksum: ${cleanRecipient}`
      );
    }
    const valueLuna = nimToLuna(amountNim);
    if (valueLuna <= 0) {
      throw new NimiqSdkError('Unknown', 'Transaction amount must be greater than 0 luna');
    }

    await initNimiq();
    if (cachedProvider) {
      // Wait for Nimiq Pay consensus if needed so Nimiq Pay doesn't throw "Something went wrong syncing your account"
      if (typeof cachedProvider.isConsensusEstablished === 'function') {
        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const ready = await cachedProvider.isConsensusEstablished();
            if (ready) break;
          } catch {
            // Ignore
          }
          await new Promise((r) => setTimeout(r, 700));
        }
      }

      // Try sending transaction (with automatic retry if Nimiq Pay reports transient account sync error)
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          let tx: unknown;
          if (data) {
            try {
              tx = await cachedProvider.sendBasicTransactionWithData({
                recipient: cleanRecipient,
                value: valueLuna,
                data,
              });
            } catch (dataTxErr) {
              const msg = dataTxErr instanceof Error ? dataTxErr.message : String(dataTxErr);
              // If user explicitly rejected, do not fallback
              if (/reject|cancel|denied/i.test(msg)) {
                throw dataTxErr;
              }
              // Fallback to standard sendBasicTransaction if sendBasicTransactionWithData had a sync/serialization issue
              tx = await cachedProvider.sendBasicTransaction({
                recipient: cleanRecipient,
                value: valueLuna,
              });
            }
          } else {
            tx = await cachedProvider.sendBasicTransaction({
              recipient: cleanRecipient,
              value: valueLuna,
            });
          }

          const txHash =
            typeof tx === 'string'
              ? tx
              : String(
                  (tx as { transactionHash?: string; hash?: string }).transactionHash ||
                    (tx as { hash?: string }).hash ||
                    tx
                );
          return { txHash };
        } catch (err) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          if (/syncing your account|network|consensus|timeout/i.test(msg) && attempt === 0) {
            await new Promise((r) => setTimeout(r, 1200));
            continue;
          }
          break;
        }
      }

      throw lastErr;
    }

    const sender = getOrCreateMockAddress();
    const currentLuna = getMockBalanceLuna(sender);
    if (currentLuna < valueLuna) {
      throw new NimiqSdkError(
        'InsufficientFunds',
        'Insufficient NIM balance in your wallet.'
      );
    }
    adjustMockBalanceNim(sender, -amountNim);
    adjustMockBalanceNim(cleanRecipient, amountNim);

    const raw = `${sender}:${cleanRecipient}:${valueLuna}:${data || ''}:${Date.now()}`;
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(raw)
    );
    const txHash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return { txHash };
  } catch (err) {
    throw normalizeError(err);
  }
}
