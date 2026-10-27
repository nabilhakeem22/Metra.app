import { beforeEach, describe, expect, it, vi } from 'vitest';

// H6.2: the two contract reads signing makes. The sign act's hash is /c's own
// (contractPayloadHash over the whole snapshot), and only for the contract the
// client is signing; the page's signing document is null, never a thrown page,
// when its read fails, with one redacted log line.

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import { contractPayloadHash } from '@/lib/contracts/public';
import type { PublicContract } from '@/lib/contracts/public-types';
import { hashShareToken } from '@/lib/share/token';
import { contractDocumentOf, getHomeContractPayloadHash, readSigningDocument } from './contract';

const CONTRACT_ID = '0b6f8e0c-2c1d-4c55-9c1a-6a1c8f0d0001';
const OTHER_ID = '0b6f8e0c-2c1d-4c55-9c1a-6a1c8f0d0002';

/** The snapshot app_home_contract_by_token answers: /c's JSON, cut down to what the hash and the document read. */
const SNAPSHOT = {
  id: CONTRACT_ID,
  status: 'issued',
  source: 'boq',
  total: '1140.0000',
  terms_ar: 'الشروط',
  lines_digest: 'f'.repeat(64),
  payment_schedule: [],
  section_count: 1,
  sections: [{ id: 's-1', title_ar: 'هدم', title_en: 'Demolition', section_subtotal: '1000.0000', sort_order: 0, line_count: 1, lines: [] }],
} as unknown as PublicContract;

/** The one statement's bound values: the token's hash only. */
const boundParams = () => {
  const [query] = sdf.readSdfJson.mock.calls[0] as [{ queryChunks: unknown[] }];
  return query.queryChunks.filter((chunk) => typeof chunk !== 'object');
};

beforeEach(() => {
  sdf.readSdfJson.mockReset();
  sdf.readSdfJson.mockResolvedValue(SNAPSHOT);
});

describe('getHomeContractPayloadHash', () => {
  it('is contractPayloadHash of the home snapshot, read once by the token hash, for the contract named in any case', async () => {
    expect(await getHomeContractPayloadHash(' tok ', CONTRACT_ID.toUpperCase())).toBe(contractPayloadHash(SNAPSHOT));
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sdf.readSdfJson.mock.calls[0][0])).toContain('app_home_contract_by_token');
    expect(boundParams()).toEqual([hashShareToken('tok')]);
  });

  it('is null when the home shows another contract, none, or the link is blank (no round trip then)', async () => {
    expect(await getHomeContractPayloadHash('tok', OTHER_ID)).toBeNull();
    sdf.readSdfJson.mockResolvedValueOnce(null);
    expect(await getHomeContractPayloadHash('tok', CONTRACT_ID)).toBeNull();
    sdf.readSdfJson.mockClear();
    expect(await getHomeContractPayloadHash('  ', CONTRACT_ID)).toBeNull();
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });
});

describe('readSigningDocument', () => {
  it('is the document of the contract named, as the tap would open it', async () => {
    expect(await readSigningDocument('tok', CONTRACT_ID)).toEqual(contractDocumentOf(SNAPSHOT));
  });

  it('is null for another contract or none', async () => {
    expect(await readSigningDocument('tok', OTHER_ID)).toBeNull();
    sdf.readSdfJson.mockResolvedValueOnce(null);
    expect(await readSigningDocument('tok', CONTRACT_ID)).toBeNull();
  });

  it('a read that failed is null with ONE log line that carries neither the token nor its hash', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // As drizzle throws a failed query: its message and own fields carry the bound token hash.
    const params = [hashShareToken('tok')];
    sdf.readSdfJson.mockRejectedValueOnce(Object.assign(new Error(`Failed query: params: ${params[0]}`), { query: 'select', params }));
    expect(await readSigningDocument('tok', CONTRACT_ID)).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    const line = JSON.stringify(logged.mock.calls[0]);
    expect(line).toContain('signing document read failed');
    expect(line).not.toContain(hashShareToken('tok'));
    expect(line).not.toContain('tok"');
    logged.mockRestore();
  });
});
