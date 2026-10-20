import { z } from 'zod';

export const QRPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('request'),
    slug: z.string().min(3),
    version: z.string().default('1'),
  }),
  z.object({
    type: z.literal('redpacket'),
    slug: z.string().min(3),
    version: z.string().default('1'),
  }),
  z.object({
    type: z.literal('unknown'),
    raw: z.string(),
    reason: z.string(),
  }),
]);

export type ParsedQRPayload = z.infer<typeof QRPayloadSchema>;

export function encodeRequestQR(slug: string, origin = window.location.origin): {
  deepLink: string;
  webLink: string;
} {
  return {
    deepLink: `nimora://request?id=${encodeURIComponent(slug)}&v=1`,
    webLink: `${origin}/r/${encodeURIComponent(slug)}`,
  };
}

export function encodeRedPacketQR(slug: string, origin = window.location.origin): {
  deepLink: string;
  webLink: string;
} {
  return {
    deepLink: `nimora://redpacket?id=${encodeURIComponent(slug)}&v=1`,
    webLink: `${origin}/rp/${encodeURIComponent(slug)}`,
  };
}

export function parseQRPayload(input: string): ParsedQRPayload {
  const trimmed = input.trim();
  if (!trimmed) {
    return { type: 'unknown', raw: input, reason: 'Empty QR code or link' };
  }

  // 1. Check custom scheme: nimora://request?id=<slug>&v=1 or nimora://redpacket?id=<slug>&v=1
  if (trimmed.startsWith('nimora://')) {
    try {
      const url = new URL(trimmed);
      const kind = url.hostname || url.pathname.replace(/^\/+/, '');
      const id = url.searchParams.get('id') || '';
      const v = url.searchParams.get('v') || '1';
      if (kind === 'request' && /^[a-zA-Z0-9_-]{3,64}$/.test(id)) {
        return { type: 'request', slug: id, version: v };
      }
      if (kind === 'redpacket' && /^[a-zA-Z0-9_-]{3,64}$/.test(id)) {
        return { type: 'redpacket', slug: id, version: v };
      }
      return { type: 'unknown', raw: trimmed, reason: 'Unrecognized Nimora URI parameters' };
    } catch {
      return { type: 'unknown', raw: trimmed, reason: 'Malformed nimora:// URI' };
    }
  }

  // 2. Check HTTPS / HTTP links: /r/<slug>, /request/pay/<slug>, /rp/<slug>, /redpacket/claim/<slug>
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')) {
    try {
      const url = trimmed.startsWith('/')
        ? new URL(trimmed, 'https://nimora.app')
        : new URL(trimmed);
      const reqMatch = url.pathname.match(/^\/(?:r|request\/pay)\/([a-zA-Z0-9_-]{3,64})$/);
      if (reqMatch) {
        return { type: 'request', slug: reqMatch[1], version: '1' };
      }
      const rpMatch = url.pathname.match(/^\/(?:rp|redpacket\/claim)\/([a-zA-Z0-9_-]{3,64})$/);
      if (rpMatch) {
        return { type: 'redpacket', slug: rpMatch[1], version: '1' };
      }
      return {
        type: 'unknown',
        raw: trimmed,
        reason: 'External or unsupported URL. Nimora never auto-navigates to external websites.',
      };
    } catch {
      return { type: 'unknown', raw: trimmed, reason: 'Invalid URL format' };
    }
  }

  // 3. Direct slug shorthand (req-xxxx or rp-xxxx)
  if (/^req-[a-zA-Z0-9_-]{3,32}$/.test(trimmed)) {
    return { type: 'request', slug: trimmed, version: '1' };
  }
  if (/^(?:rp-|welcome-nimora)[a-zA-Z0-9_-]{2,32}$/.test(trimmed)) {
    return { type: 'redpacket', slug: trimmed, version: '1' };
  }

  return {
    type: 'unknown',
    raw: trimmed,
    reason: 'Payload is not a valid Nimora Payment Request or Red Packet code.',
  };
}

export function parseNimoraQR(raw: string): {
  type: 'REQUEST' | 'REDPACKET' | 'RAW_ADDRESS' | 'UNKNOWN';
  slug?: string;
  address?: string;
  amountNim?: number;
} {
  const parsed = parseQRPayload(raw);
  if (parsed.type === 'request') {
    return { type: 'REQUEST', slug: parsed.slug };
  }
  if (parsed.type === 'redpacket') {
    return { type: 'REDPACKET', slug: parsed.slug };
  }
  const clean = raw.trim().replace(/[^0-9A-Z]/gi, '').toUpperCase();
  if (clean.startsWith('NQ') && clean.length === 36) {
    const formatted = clean.match(/.{1,4}/g)?.join(' ') || raw.trim();
    return { type: 'RAW_ADDRESS', address: formatted, amountNim: 100 };
  }
  return { type: 'UNKNOWN' };
}

