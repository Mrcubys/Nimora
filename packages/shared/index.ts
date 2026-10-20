import { z } from 'zod';

export type PaymentFieldKey =
  | 'accountName'
  | 'accountNumber'
  | 'phone'
  | 'iban'
  | 'routingNumber'
  | 'email';

export interface PaymentMethodDef {
  code: string;
  name: string;
  type: 'BANK' | 'EWALLET';
  fields: PaymentFieldKey[];
  accountNumberPattern?: string;
  placeholder?: string;
}

export interface RegionConfig {
  country: string; // ISO-3166 alpha-2
  countryName: string;
  flag: string;
  currency: string; // ISO-4217
  currencySymbol: string;
  defaultLocale: string;
  rtl?: boolean;
  defaultNimPriceFiat: number; // baseline fallback price for 1 NIM in local currency
  minTradeNim: number;
  maxTradeNim: number;
  paymentMethods: PaymentMethodDef[];
}

export const ADMIN_WALLET_ADDRESS =
  'NQ47 JQ20 R4SM 53AY 9Y9F VQKF FMJP Q6AU KURR';

export function normalizeNimiqAddress(addr: string): string {
  const clean = addr.replace(/[^0-9A-Z]/gi, '').toUpperCase();
  if (clean.length !== 36) return addr.trim().toUpperCase();
  return clean.match(/.{1,4}/g)?.join(' ') || addr.trim().toUpperCase();
}

export const COUNTRY_LANGUAGE_MAP: Record<string, string> = {
  ID: 'id',
  MY: 'ms',
  US: 'en',
  GB: 'en',
  AU: 'en',
  SG: 'en',
  IN: 'hi',
  PH: 'en',
  CA: 'en',
  NG: 'en',
  ES: 'es',
  MX: 'es',
  BR: 'pt',
  PT: 'pt',
  DE: 'de',
  AT: 'de',
  CH: 'de',
  FR: 'fr',
  JP: 'ja',
  KR: 'ko',
  TR: 'tr',
  VN: 'vi',
  TH: 'th',
  NL: 'en',
  SA: 'ar',
  AE: 'ar',
};

export const SUPPORTED_REGIONS: Record<string, RegionConfig> = {
  ID: {
    country: 'ID',
    countryName: 'Indonesia',
    flag: '🇮🇩',
    currency: 'IDR',
    currencySymbol: 'Rp',
    defaultLocale: 'id',
    defaultNimPriceFiat: 21.8,
    minTradeNim: 100,
    maxTradeNim: 500000,
    paymentMethods: [
      { code: 'BCA', name: 'Bank Central Asia (BCA)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10}$', placeholder: '10 digit nomor rekening BCA' },
      { code: 'MANDIRI', name: 'Bank Mandiri', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{13}$', placeholder: '13 digit nomor rekening Mandiri' },
      { code: 'BNI', name: 'Bank Negara Indonesia (BNI)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10}$', placeholder: '10 digit nomor rekening BNI' },
      { code: 'BRI', name: 'Bank Rakyat Indonesia (BRI)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{15}$', placeholder: '15 digit nomor rekening BRI' },
      { code: 'CIMB_ID', name: 'CIMB Niaga', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{12,13}$' },
      { code: 'PERMATA', name: 'PermataBank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10}$' },
      { code: 'GOPAY', name: 'GoPay', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+62|62|0)8[1-9][0-9]{6,10}$', placeholder: '0812xxxxxxxx' },
      { code: 'OVO', name: 'OVO', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+62|62|0)8[1-9][0-9]{6,10}$' },
      { code: 'DANA', name: 'DANA', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+62|62|0)8[1-9][0-9]{6,10}$' },
      { code: 'SHOPEEPAY', name: 'ShopeePay', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+62|62|0)8[1-9][0-9]{6,10}$' },
      { code: 'LINKAJA', name: 'LinkAja', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+62|62|0)8[1-9][0-9]{6,10}$' },
    ],
  },
  SG: {
    country: 'SG',
    countryName: 'Singapore',
    flag: '🇸🇬',
    currency: 'SGD',
    currencySymbol: 'S$',
    defaultLocale: 'en',
    defaultNimPriceFiat: 0.00185,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'PAYNOW', name: 'PayNow (Mobile / NRIC)', type: 'EWALLET', fields: ['accountName', 'phone'], placeholder: '+65 8xxxxxxx or UEN' },
      { code: 'DBS', name: 'DBS / POSB Bank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9-]{9,14}$' },
      { code: 'OCBC', name: 'OCBC Bank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9-]{9,14}$' },
      { code: 'UOB', name: 'United Overseas Bank (UOB)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9-]{9,14}$' },
      { code: 'GRABPAY_SG', name: 'GrabPay Singapore', type: 'EWALLET', fields: ['accountName', 'phone'] },
    ],
  },
  IN: {
    country: 'IN',
    countryName: 'India',
    flag: '🇮🇳',
    currency: 'INR',
    currencySymbol: '₹',
    defaultLocale: 'hi',
    defaultNimPriceFiat: 0.118,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'UPI', name: 'UPI (Unified Payments Interface)', type: 'EWALLET', fields: ['accountName', 'accountNumber'], placeholder: 'username@okaxis / @ybl' },
      { code: 'PHONEPE', name: 'PhonePe', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+91|0)?[6-9][0-9]{9}$' },
      { code: 'GPAY_IN', name: 'Google Pay (Tez)', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+91|0)?[6-9][0-9]{9}$' },
      { code: 'PAYTM', name: 'Paytm Wallet / Bank', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+91|0)?[6-9][0-9]{9}$' },
      { code: 'IMPS_HDFC', name: 'HDFC Bank (IMPS / NEFT)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{9,18}$' },
      { code: 'IMPS_SBI', name: 'State Bank of India (SBI)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{9,18}$' },
      { code: 'IMPS_ICICI', name: 'ICICI Bank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{9,18}$' },
    ],
  },
  GB: {
    country: 'GB',
    countryName: 'United Kingdom',
    flag: '🇬🇧',
    currency: 'GBP',
    currencySymbol: '£',
    defaultLocale: 'en',
    defaultNimPriceFiat: 0.00108,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'FASTER_PAYMENTS', name: 'UK Faster Payments', type: 'BANK', fields: ['accountName', 'accountNumber'], placeholder: 'Sort code + 8-digit account number' },
      { code: 'REVOLUT_UK', name: 'Revolut UK', type: 'EWALLET', fields: ['accountName', 'accountNumber'], placeholder: '@revtag or UK account number' },
      { code: 'MONZO', name: 'Monzo Bank', type: 'BANK', fields: ['accountName', 'accountNumber'] },
      { code: 'BARCLAYS', name: 'Barclays UK', type: 'BANK', fields: ['accountName', 'accountNumber'] },
      { code: 'HSBC_UK', name: 'HSBC UK', type: 'BANK', fields: ['accountName', 'accountNumber'] },
    ],
  },
  MY: {
    country: 'MY',
    countryName: 'Malaysia',
    flag: '🇲🇾',
    currency: 'MYR',
    currencySymbol: 'RM',
    defaultLocale: 'ms',
    defaultNimPriceFiat: 0.0061,
    minTradeNim: 100,
    maxTradeNim: 500000,
    paymentMethods: [
      { code: 'DUITNOW', name: 'DuitNow QR / ID', type: 'EWALLET', fields: ['accountName', 'phone'] },
      { code: 'MAYBANK', name: 'Maybank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{12}$' },
      { code: 'CIMB_MY', name: 'CIMB Bank Malaysia', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10,14}$' },
      { code: 'PUBLIC_BANK', name: 'Public Bank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10}$' },
      { code: 'RHB', name: 'RHB Bank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{14}$' },
      { code: 'TNG', name: "Touch 'n Go eWallet", type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+?60|0)1[0-9]{8,9}$' },
      { code: 'GRABPAY_MY', name: 'GrabPay', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+?60|0)1[0-9]{8,9}$' },
    ],
  },
  PH: {
    country: 'PH',
    countryName: 'Philippines',
    flag: '🇵🇭',
    currency: 'PHP',
    currencySymbol: '₱',
    defaultLocale: 'en',
    defaultNimPriceFiat: 0.081,
    minTradeNim: 100,
    maxTradeNim: 500000,
    paymentMethods: [
      { code: 'GCASH', name: 'GCash', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+?63|0)9[0-9]{9}$' },
      { code: 'MAYA', name: 'Maya', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+?63|0)9[0-9]{9}$' },
      { code: 'BDO', name: 'BDO Unibank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10,12}$' },
      { code: 'BPI', name: 'Bank of the Philippine Islands (BPI)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10}$' },
      { code: 'UNIONBANK', name: 'UnionBank of the Philippines', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{12}$' },
    ],
  },
  VN: {
    country: 'VN',
    countryName: 'Vietnam',
    flag: '🇻🇳',
    currency: 'VND',
    currencySymbol: '₫',
    defaultLocale: 'vi',
    defaultNimPriceFiat: 35.4,
    minTradeNim: 100,
    maxTradeNim: 500000,
    paymentMethods: [
      { code: 'VIETCOMBANK', name: 'Vietcombank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10,13}$' },
      { code: 'TECHCOMBANK', name: 'Techcombank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10,14}$' },
      { code: 'MBBANK', name: 'MB Bank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{9,13}$' },
      { code: 'MOMO', name: 'MoMo', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+?84|0)[35789][0-9]{8}$' },
      { code: 'ZALOPAY', name: 'ZaloPay', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+?84|0)[35789][0-9]{8}$' },
    ],
  },
  TH: {
    country: 'TH',
    countryName: 'Thailand',
    flag: '🇹🇭',
    currency: 'THB',
    currencySymbol: '฿',
    defaultLocale: 'th',
    defaultNimPriceFiat: 0.047,
    minTradeNim: 100,
    maxTradeNim: 500000,
    paymentMethods: [
      { code: 'PROMPTPAY', name: 'PromptPay', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^[0-9]{10,13}$' },
      { code: 'KBANK', name: 'Kasikornbank (KBank)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10}$' },
      { code: 'SCB', name: 'Siam Commercial Bank (SCB)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10}$' },
      { code: 'BBL', name: 'Bangkok Bank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10}$' },
      { code: 'TRUEMONEY', name: 'TrueMoney Wallet', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^0[689][0-9]{8}$' },
    ],
  },
  US: {
    country: 'US',
    countryName: 'United States',
    flag: '🇺🇸',
    currency: 'USD',
    currencySymbol: '$',
    defaultLocale: 'en',
    defaultNimPriceFiat: 0.00138,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'ACH', name: 'ACH Bank Transfer', type: 'BANK', fields: ['accountName', 'accountNumber', 'routingNumber'], accountNumberPattern: '^[0-9]{6,17}$' },
      { code: 'ZELLE', name: 'Zelle', type: 'EWALLET', fields: ['accountName', 'email', 'phone'] },
      { code: 'CASHAPP', name: 'Cash App', type: 'EWALLET', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^\\$?[a-zA-Z0-9_]{1,20}$' },
      { code: 'VENMO', name: 'Venmo', type: 'EWALLET', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^@?[a-zA-Z0-9_-]{3,30}$' },
    ],
  },
  AU: {
    country: 'AU',
    countryName: 'Australia',
    flag: '🇦🇺',
    currency: 'AUD',
    currencySymbol: 'A$',
    defaultLocale: 'en',
    defaultNimPriceFiat: 0.00212,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'PAYID', name: 'PayID / Osko Instant', type: 'EWALLET', fields: ['accountName', 'phone'], placeholder: 'Mobile or Email PayID' },
      { code: 'COMM_AU', name: 'Commonwealth Bank (CommBank)', type: 'BANK', fields: ['accountName', 'accountNumber'] },
      { code: 'ANZ', name: 'ANZ Bank', type: 'BANK', fields: ['accountName', 'accountNumber'] },
      { code: 'WESTPAC', name: 'Westpac', type: 'BANK', fields: ['accountName', 'accountNumber'] },
    ],
  },
  CA: {
    country: 'CA',
    countryName: 'Canada',
    flag: '🇨🇦',
    currency: 'CAD',
    currencySymbol: 'C$',
    defaultLocale: 'en',
    defaultNimPriceFiat: 0.00192,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'INTERAC', name: 'Interac e-Transfer', type: 'EWALLET', fields: ['accountName', 'email'], placeholder: 'Registered Interac email' },
      { code: 'RBC', name: 'Royal Bank of Canada (RBC)', type: 'BANK', fields: ['accountName', 'accountNumber'] },
      { code: 'TD_CA', name: 'TD Canada Trust', type: 'BANK', fields: ['accountName', 'accountNumber'] },
    ],
  },
  DE: {
    country: 'DE',
    countryName: 'Germany',
    flag: '🇩🇪',
    currency: 'EUR',
    currencySymbol: '€',
    defaultLocale: 'de',
    defaultNimPriceFiat: 0.00128,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'SEPA_DE', name: 'SEPA Bank Transfer (IBAN)', type: 'BANK', fields: ['accountName', 'iban'], accountNumberPattern: '^DE[0-9]{20}$' },
      { code: 'N26', name: 'N26 Instant Transfer', type: 'BANK', fields: ['accountName', 'iban'], accountNumberPattern: '^DE[0-9]{20}$' },
      { code: 'REVOLUT_EU', name: 'Revolut Euro', type: 'EWALLET', fields: ['accountName', 'iban'] },
    ],
  },
  FR: {
    country: 'FR',
    countryName: 'France',
    flag: '🇫🇷',
    currency: 'EUR',
    currencySymbol: '€',
    defaultLocale: 'fr',
    defaultNimPriceFiat: 0.00128,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'SEPA_FR', name: 'Virement SEPA (IBAN)', type: 'BANK', fields: ['accountName', 'iban'] },
      { code: 'PAYLIB', name: 'Paylib / Wero', type: 'EWALLET', fields: ['accountName', 'phone'] },
      { code: 'REVOLUT_FR', name: 'Revolut France', type: 'EWALLET', fields: ['accountName', 'iban'] },
    ],
  },
  ES: {
    country: 'ES',
    countryName: 'Spain',
    flag: '🇪🇸',
    currency: 'EUR',
    currencySymbol: '€',
    defaultLocale: 'es',
    defaultNimPriceFiat: 0.00128,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'BIZUM', name: 'Bizum', type: 'EWALLET', fields: ['accountName', 'phone'], accountNumberPattern: '^(\\+?34)?[67][0-9]{8}$' },
      { code: 'SEPA_ES', name: 'SEPA Bank Transfer (IBAN)', type: 'BANK', fields: ['accountName', 'iban'], accountNumberPattern: '^ES[0-9]{22}$' },
    ],
  },
  NL: {
    country: 'NL',
    countryName: 'Netherlands',
    flag: '🇳🇱',
    currency: 'EUR',
    currencySymbol: '€',
    defaultLocale: 'en',
    defaultNimPriceFiat: 0.00128,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'IDEAL', name: 'iDEAL', type: 'EWALLET', fields: ['accountName', 'iban'], accountNumberPattern: '^NL[0-9]{2}[A-Z]{4}[0-9]{10}$' },
      { code: 'SEPA_NL', name: 'SEPA Bank Transfer (IBAN)', type: 'BANK', fields: ['accountName', 'iban'], accountNumberPattern: '^NL[0-9]{2}[A-Z]{4}[0-9]{10}$' },
    ],
  },
  CH: {
    country: 'CH',
    countryName: 'Switzerland',
    flag: '🇨🇭',
    currency: 'CHF',
    currencySymbol: 'CHF',
    defaultLocale: 'de',
    defaultNimPriceFiat: 0.00121,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'TWINT', name: 'TWINT', type: 'EWALLET', fields: ['accountName', 'phone'] },
      { code: 'UBS_CH', name: 'UBS / PostFinance IBAN', type: 'BANK', fields: ['accountName', 'iban'] },
    ],
  },
  BR: {
    country: 'BR',
    countryName: 'Brazil',
    flag: '🇧🇷',
    currency: 'BRL',
    currencySymbol: 'R$',
    defaultLocale: 'pt',
    defaultNimPriceFiat: 0.0078,
    minTradeNim: 100,
    maxTradeNim: 750000,
    paymentMethods: [
      { code: 'PIX', name: 'Pix Instant Payment', type: 'EWALLET', fields: ['accountName', 'accountNumber'] },
      { code: 'NUBANK', name: 'Nubank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9-]{5,14}$' },
      { code: 'ITAU', name: 'Itaú Unibanco', type: 'BANK', fields: ['accountName', 'accountNumber'] },
    ],
  },
  MX: {
    country: 'MX',
    countryName: 'Mexico',
    flag: '🇲🇽',
    currency: 'MXN',
    currencySymbol: 'Mex$',
    defaultLocale: 'es',
    defaultNimPriceFiat: 0.027,
    minTradeNim: 100,
    maxTradeNim: 750000,
    paymentMethods: [
      { code: 'SPEI', name: 'SPEI Transferencia (CLABE)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{18}$' },
      { code: 'BBVA_MX', name: 'BBVA México', type: 'BANK', fields: ['accountName', 'accountNumber'] },
      { code: 'MERCADOPAGO_MX', name: 'Mercado Pago', type: 'EWALLET', fields: ['accountName', 'phone'] },
    ],
  },
  JP: {
    country: 'JP',
    countryName: 'Japan',
    flag: '🇯🇵',
    currency: 'JPY',
    currencySymbol: '¥',
    defaultLocale: 'ja',
    defaultNimPriceFiat: 0.21,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'PAYPAY', name: 'PayPay', type: 'EWALLET', fields: ['accountName', 'phone'] },
      { code: 'MUFG', name: 'MUFG Bank (三菱UFJ銀行)', type: 'BANK', fields: ['accountName', 'accountNumber'] },
      { code: 'SMBC', name: 'SMBC (三井住友銀行)', type: 'BANK', fields: ['accountName', 'accountNumber'] },
    ],
  },
  KR: {
    country: 'KR',
    countryName: 'South Korea',
    flag: '🇰🇷',
    currency: 'KRW',
    currencySymbol: '₩',
    defaultLocale: 'ko',
    defaultNimPriceFiat: 1.92,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'KAKAOPAY', name: 'KakaoPay (카카오페이)', type: 'EWALLET', fields: ['accountName', 'phone'] },
      { code: 'TOSS', name: 'Toss Bank (토스뱅크)', type: 'BANK', fields: ['accountName', 'accountNumber'] },
      { code: 'KB_KR', name: 'KB Kookmin Bank (국민은행)', type: 'BANK', fields: ['accountName', 'accountNumber'] },
    ],
  },
  TR: {
    country: 'TR',
    countryName: 'Turkey',
    flag: '🇹🇷',
    currency: 'TRY',
    currencySymbol: '₺',
    defaultLocale: 'tr',
    defaultNimPriceFiat: 0.048,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'FAST_TR', name: 'FAST / IBAN Transfer', type: 'BANK', fields: ['accountName', 'iban'], placeholder: 'TR + 24 digits' },
      { code: 'PAPARA', name: 'Papara', type: 'EWALLET', fields: ['accountName', 'accountNumber'] },
      { code: 'ZIRAAT', name: 'Ziraat Bankası', type: 'BANK', fields: ['accountName', 'iban'] },
    ],
  },
  NG: {
    country: 'NG',
    countryName: 'Nigeria',
    flag: '🇳🇬',
    currency: 'NGN',
    currencySymbol: '₦',
    defaultLocale: 'en',
    defaultNimPriceFiat: 2.25,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'OPAY', name: 'OPay', type: 'EWALLET', fields: ['accountName', 'phone'] },
      { code: 'PALMPAY', name: 'PalmPay', type: 'EWALLET', fields: ['accountName', 'phone'] },
      { code: 'GTBANK', name: 'Guaranty Trust Bank (GTBank)', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10}$' },
      { code: 'ZENITH', name: 'Zenith Bank', type: 'BANK', fields: ['accountName', 'accountNumber'], accountNumberPattern: '^[0-9]{10}$' },
    ],
  },
  SA: {
    country: 'SA',
    countryName: 'Saudi Arabia',
    flag: '🇸🇦',
    currency: 'SAR',
    currencySymbol: 'ر.س',
    defaultLocale: 'ar',
    rtl: true,
    defaultNimPriceFiat: 0.0052,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'STCPAY', name: 'STC Pay', type: 'EWALLET', fields: ['accountName', 'phone'] },
      { code: 'ALRAJHI', name: 'Al Rajhi Bank (مصرف الراجحي)', type: 'BANK', fields: ['accountName', 'iban'] },
      { code: 'SNB_SA', name: 'Saudi National Bank (SNB)', type: 'BANK', fields: ['accountName', 'iban'] },
    ],
  },
  AE: {
    country: 'AE',
    countryName: 'United Arab Emirates',
    flag: '🇦🇪',
    currency: 'AED',
    currencySymbol: 'د.إ',
    defaultLocale: 'ar',
    rtl: true,
    defaultNimPriceFiat: 0.0051,
    minTradeNim: 100,
    maxTradeNim: 1000000,
    paymentMethods: [
      { code: 'ENBD', name: 'Emirates NBD', type: 'BANK', fields: ['accountName', 'iban'], accountNumberPattern: '^AE[0-9]{21}$' },
      { code: 'ADCB', name: 'Abu Dhabi Commercial Bank (ADCB)', type: 'BANK', fields: ['accountName', 'iban'], accountNumberPattern: '^AE[0-9]{21}$' },
      { code: 'AANI', name: 'Aani Instant Pay', type: 'EWALLET', fields: ['accountName', 'phone'] },
    ],
  },
};

export interface CountryListItem {
  code: string;
  name: string;
  flag: string;
  supported: boolean;
  currency?: string;
  defaultLocale?: string;
}

export const ALL_COUNTRIES_CATALOG: CountryListItem[] = Object.values(
  SUPPORTED_REGIONS
)
  .map((r) => ({
    code: r.country,
    name: r.countryName,
    flag: r.flag,
    supported: true,
    currency: r.currency,
    defaultLocale: r.defaultLocale,
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function normalizeHolderName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function doesHolderNameMatch(realName: string, accountName: string): boolean {
  return normalizeHolderName(realName) === normalizeHolderName(accountName);
}

export function maskAccountNumber(val: string): string {
  const clean = val.trim();
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 2)}••••${clean.slice(-4)}`;
}

// Order statuses
export type P2POrderStatus =
  | 'CREATED'
  | 'AWAITING_DEPOSIT'
  | 'CRYPTO_LOCKED'
  | 'AWAITING_PAYMENT'
  | 'PAYMENT_SUBMITTED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'DISPUTED'
  | 'RESOLVED_RELEASED'
  | 'RESOLVED_REFUNDED';

export type CancelReason =
  | 'SELLER_NO_DEPOSIT'
  | 'BUYER_NO_PAYMENT'
  | 'MANUAL_BY_BUYER'
  | 'MANUAL_BY_SELLER'
  | 'ADMIN_CANCELLED';

// Zod Schemas
export const OnboardSchema = z.object({
  realName: z
    .string()
    .trim()
    .min(2, 'Real Name must be at least 2 characters')
    .max(80, 'Real Name cannot exceed 80 characters')
    .regex(/^[a-zA-Z\u00C0-\u024F\s.'-]+$/, 'Real Name may only contain letters, spaces, and standard name punctuation'),
  country: z.string().length(2, 'Country must be a valid ISO-3166 alpha-2 code'),
  confirmedImmutable: z.literal(true, {
    message: 'You must confirm that Real Name and Country cannot be changed later',
  }),
});

export const CreatePaymentMethodSchema = z.object({
  providerCode: z.string().min(1),
  accountName: z.string().trim().min(2).max(80),
  accountNumber: z.string().trim().min(3).max(64),
  extraFields: z.record(z.string(), z.string()).optional(),
});

export const CreateP2PAdSchema = z.object({
  side: z.enum(['SELL_NIM', 'BUY_NIM']),
  priceMode: z.enum(['FIXED', 'MARKET_MARGIN']),
  price: z.number().positive(),
  minAmountNim: z.number().min(10),
  maxAmountNim: z.number().min(10),
  availableNim: z.number().min(10),
  paymentMethodIds: z.array(z.string()).min(1, 'At least one payment method is required'),
});

export const CreateOrderSchema = z.object({
  adId: z.string().min(1),
  amountNim: z.number().positive(),
  paymentMethodId: z.string().min(1),
});

export const FastMatchSchema = z.object({
  side: z.enum(['BUY_NIM', 'SELL_NIM']),
  amountNim: z.number().positive(),
  providerCode: z.string().min(1),
});

export const SendOrderMessageSchema = z.object({
  type: z.enum(['TEXT', 'IMAGE']).default('TEXT'),
  body: z.string().trim().max(1000),
  attachmentUrl: z.string().optional(),
  attachmentMime: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  replyToId: z.string().optional(),
});

export const CreatePaymentRequestSchema = z.object({
  amountNim: z.number().positive().nullable(),
  note: z.string().trim().max(160).default(''),
  expiresInHours: z.number().min(1).max(168).default(24),
});

export const CreateRedPacketSchema = z.object({
  totalNim: z.number().min(0.001).max(1000000),
  slots: z.number().int().min(2).max(200),
  mode: z.enum(['EQUAL', 'RANDOM']),
  message: z.string().trim().max(140).default('Best wishes & prosperity!'),
});

// ============================================================================
// SOCIAL PAYMENTS & CONNECT SCHEMAS (Twitter / X and Telegram)
// ============================================================================
export interface SocialAccountItem {
  id: string;
  userId: string;
  platform: 'TWITTER' | 'TELEGRAM';
  handle: string; // normalized lowercase without @
  displayHandle: string; // e.g. @alice
  verificationCode: string;
  isVerified: boolean;
  verifiedAt: string | null;
  createdAt: string;
}

export type SocialTransferStatus =
  | 'SUCCESS'
  | 'FAILED_RECIPIENT_NOT_REGISTERED'
  | 'FAILED_INSUFFICIENT_FUNDS'
  | 'FAILED_SENDER_NOT_REGISTERED'
  | 'FAILED_INVALID_FORMAT';

export interface SocialTransferItem {
  id: string;
  platform: 'TWITTER' | 'TELEGRAM';
  senderUserId: string | null;
  senderHandle: string;
  recipientUserId: string | null;
  recipientHandle: string;
  amountNim: number;
  status: SocialTransferStatus;
  rawText: string;
  postUrlOrId?: string;
  botResponse: string;
  txHash?: string | null;
  createdAt: string;
}

export function cleanSocialHandle(handle: string): string {
  return handle.replace(/^@+/, '').trim().toLowerCase();
}

export function formatTwitterTemplate(code: string): string {
  return `Connect @nimorapay with my Twitter handle to facilitate $NIM transfers (${code}).`;
}

export function formatTelegramCommand(code: string): string {
  return `/connect ${code}`;
}

export const ConnectSocialSchema = z.object({
  platform: z.enum(['TWITTER', 'TELEGRAM']),
  handle: z
    .string()
    .trim()
    .min(1, 'Handle is required')
    .max(50, 'Handle is too long')
    .regex(/^[a-zA-Z0-9_@]+$/, 'Handle may only contain letters, numbers, underscores, and optional leading @'),
});

export const VerifySocialSchema = z.object({
  platform: z.enum(['TWITTER', 'TELEGRAM']),
  handle: z.string().trim().min(1),
  code: z.string().trim().min(1),
  postUrl: z.string().trim().optional(),
});

export const SocialSimulatePostSchema = z.object({
  platform: z.enum(['TWITTER', 'TELEGRAM']),
  senderHandle: z.string().trim().min(1),
  text: z.string().trim().min(1),
});

// ============================================================================
// CASHBACK & ESCROW MANAGEMENT SCHEMAS
// ============================================================================

export type CashbackTxType = 'P2P_SELL_ORDER' | 'TIP_TRANSACTION' | 'RED_PACKET';
export type CashbackClaimStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

export interface CashbackConfig {
  isActive: boolean;
  escrowBalanceNim: number;
  escrowWalletAddress: string;
  minTxAmountNim: number; // default 5000 NIM
  minCashbackNim: number; // default 200 NIM
  maxCashbackNim: number; // default 5000 NIM
  totalPaidOutNim: number;
  updatedAt: string;
}

export interface CashbackClaimItem {
  id: string;
  userId: string;
  userAddress: string;
  userName: string;
  txType: CashbackTxType;
  txReferenceId: string;
  txAmountNim: number;
  cashbackAmountNim: number;
  status: CashbackClaimStatus;
  fraudRiskScore: number; // 0 (safest) to 100 (high risk)
  fraudReasons: string[];
  adminNotes?: string | null;
  txHash?: string | null;
  confirmedAt?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
}

export function calculateRandomCashback(min = 200, max = 5000): number {
  const safeMin = Math.max(1, Math.floor(min));
  const safeMax = Math.max(safeMin, Math.floor(max));
  return Math.floor(Math.random() * (safeMax - safeMin + 1)) + safeMin;
}

export const UpdateCashbackConfigSchema = z.object({
  isActive: z.boolean().optional(),
  minTxAmountNim: z.number().min(100).optional(),
  minCashbackNim: z.number().min(1).optional(),
  maxCashbackNim: z.number().min(10).optional(),
});

export const DepositCashbackEscrowSchema = z.object({
  amountNim: z.number().positive('Deposit amount must be greater than 0'),
  txHash: z.string().trim().optional(),
  note: z.string().trim().max(160).optional(),
});

export const RejectCashbackSchema = z.object({
  reason: z.string().trim().min(1, 'Rejection reason is required').max(300),
});

