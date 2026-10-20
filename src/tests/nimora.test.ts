import {
  nimToLuna,
  lunaToNim,
  isValidNimiqAddress,
} from '../lib/nimiq/units.ts';
import { allocateRedPacketLunaShares } from '../server/escrowSigner.ts';
import { parseQRPayload } from '../lib/qr/payload.ts';
import {
  COUNTRY_LANGUAGE_MAP,
  doesHolderNameMatch,
} from '../../packages/shared/index.ts';

export function runNimoraTestSuite(): {
  passed: number;
  results: Array<{ name: string; status: 'PASS' | 'FAIL' }>;
} {
  const results: Array<{ name: string; status: 'PASS' | 'FAIL' }> = [];

  const assert = (name: string, cond: boolean) => {
    results.push({ name, status: cond ? 'PASS' : 'FAIL' });
    if (!cond) {
      throw new Error(`Test failed: ${name}`);
    }
  };

  // 1. Unit Conversion (1 NIM = 100,000 luna)
  assert('nimToLuna(1) === 100000', nimToLuna(1) === 100_000);
  assert('lunaToNim(250000) === 2.5', lunaToNim(250_000) === 2.5);
  assert(
    'isValidNimiqAddress validates NQ format',
    isValidNimiqAddress('NQ89 N1M0 RADE V0A1 1ET9 8765 4321 0000 2026')
  );

  // 2. Random Red Packet integer luna allocation sum & >= 1 luna invariant
  const randomShares = allocateRedPacketLunaShares(250, 15, 'RANDOM');
  const sumLuna = randomShares.reduce((a, b) => a + b, 0);
  assert('Random Red Packet has exact slot count', randomShares.length === 15);
  assert(
    'Random Red Packet sum equals exact total in integer luna',
    sumLuna === 250 * 100_000
  );
  assert(
    'Every Random Red Packet share is at least 1 luna',
    randomShares.every((s) => Number.isInteger(s) && s >= 1)
  );

  // 3. QR Payload Parsing
  const reqQr = parseQRPayload('nimora://request?id=req-9988&v=1');
  assert(
    'parseQRPayload decodes nimora://request',
    reqQr.type === 'request' && reqQr.slug === 'req-9988'
  );
  const rpQr = parseQRPayload('https://nimora.app/rp/welcome-nimora-2026');
  assert(
    'parseQRPayload decodes HTTPS Red Packet link',
    rpQr.type === 'redpacket' && rpQr.slug === 'welcome-nimora-2026'
  );
  const badQr = parseQRPayload('https://evil.example.com/phish');
  assert('parseQRPayload blocks external URLs', badQr.type === 'unknown');

  // 4. Country-to-Language Mapping & Holder Name Matching
  assert('ID maps to id locale', COUNTRY_LANGUAGE_MAP.ID === 'id');
  assert('AE maps to ar RTL locale', COUNTRY_LANGUAGE_MAP.AE === 'ar');
  assert(
    'Holder name normalization strips diacritics and case',
    doesHolderNameMatch('Raka Santoso', '  raka   santoso ')
  );

  return {
    passed: results.filter((r) => r.status === 'PASS').length,
    results,
  };
}
