export const LUNA_PER_NIM = 100_000;

export function nimToLuna(amountNim: number): number {
  if (!Number.isFinite(amountNim) || amountNim < 0) {
    throw new Error('Invalid NIM amount');
  }
  return Math.round(amountNim * LUNA_PER_NIM);
}

export function lunaToNim(amountLuna: number): number {
  if (!Number.isFinite(amountLuna)) {
    throw new Error('Invalid luna amount');
  }
  return Number((amountLuna / LUNA_PER_NIM).toFixed(5));
}

export function formatNim(amountNim: number, locale = 'en'): string {
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  }).format(amountNim)} NIM`;
}

export function formatFiat(
  amountFiat: number,
  currency: string,
  locale = 'en'
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: ['IDR', 'VND', 'JPY', 'KRW'].includes(currency)
        ? 0
        : amountFiat < 1
        ? 5
        : 2,
    }).format(amountFiat);
  } catch {
    return `${amountFiat.toLocaleString(locale)} ${currency}`;
  }
}

/**
 * Computes valid Nimiq IBAN-style MOD-97 check digits for a 32-char Base32 payload.
 */
function ibanMod97(str: string): number {
  let remainder = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const val = code >= 65 ? code - 55 : code - 48; // A=10..Z=35, 0=0..9=9
    if (val >= 10) {
      remainder = (remainder * 100 + val) % 97;
    } else {
      remainder = (remainder * 10 + val) % 97;
    }
  }
  return remainder;
}

export function normalizeNimiqAddressFormat(address: string): string {
  const cleaned = address.replace(/[^0-9A-Z]/gi, '').toUpperCase();
  if (cleaned.length !== 36) return address.trim().toUpperCase();
  return cleaned.match(/.{1,4}/g)?.join(' ') || address.trim().toUpperCase();
}

export function isValidNimiqAddress(address: string): boolean {
  const cleaned = address.replace(/\s+/g, '').toUpperCase();
  if (!/^NQ[0-9]{2}[0-9A-HJ-NP-VY-Z]{32}$/.test(cleaned)) {
    // Also allow general alphanumeric 36-char NQ addresses if needed, but check MOD 97
    if (!/^NQ[0-9]{2}[0-9A-Z]{32}$/.test(cleaned)) return false;
  }
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  return ibanMod97(rearranged) === 1;
}

export function createValidNimiqAddressFromBody(body32: string): string {
  const cleanBody = body32
    .replace(/[^0-9A-HJ-NP-VY-Z]/gi, '0')
    .toUpperCase()
    .padEnd(32, '0')
    .slice(0, 32);
  const rem = ibanMod97(cleanBody + 'NQ00');
  const check = String(98 - rem).padStart(2, '0');
  const full = `NQ${check}${cleanBody}`;
  return full.match(/.{1,4}/g)!.join(' ');
}

export function shortenAddress(address: string): string {
  const clean = address.trim();
  if (clean.length <= 16) return clean;
  return `${clean.slice(0, 9)}…${clean.slice(-7)}`;
}
