import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// H6.2: the two contract reads signing makes. Before the act: /c's own hash
// (contractPayloadHash over the whole snapshot), only for the contract the
// client is signing; signed already, or a failed read, said as such (functional
// F3, reliability R-L1). With the page: the document, its sections by title and
// total (reliability R-L3), and null, never a thrown or held page, when its read
// fails or is slow (R-L2), with one redacted log line.

vi.mock('server-only', () => ({}));
const sdf = vi.hoisted(() => ({ readSdfJson: vi.fn() }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/share/sdf-call')>()),
  readSdfJson: sdf.readSdfJson,
}));

import { contractPayloadHash } from '@/lib/contracts/public';
import type { PublicContract } from '@/lib/contracts/public-types';
import { hashShareToken } from '@/lib/share/token';
import { contractDocumentOf } from './contract';
import { SIGNING_DOCUMENT_WAIT_MS, SIGNING_SECTIONS_SHOWN, readContractToSign, readSigningDocument } from './contract-signing';

const CONTRACT_ID = '0b6f8e0c-2c1d-4c55-9c1a-6a1c8f0d0001';
const OTHER_ID = '0b6f8e0c-2c1d-4c55-9c1a-6a1c8f0d0002';
const LINE = { id: 'l-1', description_ar: 'هدم', description_en: 'Demolition', qty: '1', unit: 'item', unit_price: '1000.0000', line_total: '1000.0000' };

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
  sections: [{ id: 's-1', title_ar: 'هدم', title_en: 'Demolition', section_subtotal: '1000.0000', sort_order: 0, line_count: 1, lines: [LINE] }],
} as unknown as PublicContract;

/** The one statement's bound values: the token's hash only. */
const boundParams = () => {
  const [query] = sdf.readSdfJson.mock.calls[0] as [{ queryChunks: unknown[] }];
  return query.queryChunks.filter((chunk) => typeof chunk !== 'object');
};

/** As drizzle throws a failed query: its message and own fields carry the bound token hash. */
const leakyFailure = () => {
  const params = [hashShareToken('tok')];
  return Object.assign(new Error(`Failed query: params: ${params[0]}`), { query: 'select', params });
};

/** The console.error spy's one line, which must carry neither the token nor its hash. */
function expectOneRedactedLine(logged: { mock: { calls: unknown[][] } }, says: string) {
  expect(logged.mock.calls).toHaveLength(1);
  const line = JSON.stringify(logged.mock.calls[0]);
  expect(line).toContain(says);
  expect(line).not.toContain(hashShareToken('tok'));
  expect(line).not.toContain('tok"');
}

beforeEach(() => {
  sdf.readSdfJson.mockReset();
  sdf.readSdfJson.mockResolvedValue(SNAPSHOT);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('readContractToSign', () => {
  it('is contractPayloadHash of the home snapshot, read once by the token hash, for the contract named in any case', async () => {
    expect(await readContractToSign(' tok ', CONTRACT_ID.toUpperCase())).toEqual({ kind: 'issued', pdfHash: contractPayloadHash(SNAPSHOT) });
    expect(sdf.readSdfJson).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(sdf.readSdfJson.mock.calls[0][0])).toContain('app_home_contract_by_token');
    expect(boundParams()).toEqual([hashShareToken('tok')]);
  });

  it('is signed when the snapshot says so (functional F3)', async () => {
    sdf.readSdfJson.mockResolvedValueOnce({ ...SNAPSHOT, status: 'signed' });
    expect(await readContractToSign('tok', CONTRACT_ID)).toEqual({ kind: 'signed' });
  });

  it('is not_this when the home shows another contract, none, or the link is blank (no round trip then)', async () => {
    expect(await readContractToSign('tok', OTHER_ID)).toEqual({ kind: 'not_this' });
    sdf.readSdfJson.mockResolvedValueOnce(null);
    expect(await readContractToSign('tok', CONTRACT_ID)).toEqual({ kind: 'not_this' });
    sdf.readSdfJson.mockClear();
    expect(await readContractToSign('  ', CONTRACT_ID)).toEqual({ kind: 'not_this' });
    expect(sdf.readSdfJson).not.toHaveBeenCalled();
  });

  it('a read that failed is read_failed with ONE redacted log line (reliability R-L1)', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sdf.readSdfJson.mockRejectedValueOnce(leakyFailure());
    expect(await readContractToSign('tok', CONTRACT_ID)).toEqual({ kind: 'read_failed' });
    expectOneRedactedLine(logged, 'signing hash read failed');
  });
});

describe('readSigningDocument', () => {
  it('is the document of the contract named: its figures and schedule, its first sections by title and total, lines left to a tap (R-L3)', async () => {
    const document = await readSigningDocument('tok', CONTRACT_ID);
    const opened = contractDocumentOf(SNAPSHOT);
    expect(document).toEqual({ ...opened, sections: opened.sections.map((section) => ({ ...section, lines: [] })) });
    expect(document?.sections[0]).toMatchObject({ id: 's-1', section_subtotal: '1000.0000', line_count: 1 });
  });

  it('opens with at most SIGNING_SECTIONS_SHOWN sections and keeps the section count, so "show more sections" reads the rest', async () => {
    const sections = Array.from({ length: 50 }, (_, index) => ({ ...SNAPSHOT.sections[0], id: `s-${index}` }));
    sdf.readSdfJson.mockResolvedValueOnce({ ...SNAPSHOT, section_count: 230, sections });
    const document = await readSigningDocument('tok', CONTRACT_ID);
    expect(document?.sections.map((section) => section.id)).toEqual(sections.slice(0, SIGNING_SECTIONS_SHOWN).map((section) => section.id));
    expect(document?.section_count).toBe(230);
  });

  it('is null for another contract or none', async () => {
    expect(await readSigningDocument('tok', OTHER_ID)).toBeNull();
    sdf.readSdfJson.mockResolvedValueOnce(null);
    expect(await readSigningDocument('tok', CONTRACT_ID)).toBeNull();
  });

  it('a read that failed is null with ONE redacted log line', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sdf.readSdfJson.mockRejectedValueOnce(leakyFailure());
    expect(await readSigningDocument('tok', CONTRACT_ID)).toBeNull();
    expectOneRedactedLine(logged, 'signing document read failed');
  });

  it('a read still going after 5 s is null with ONE log line, and its late failure is not unhandled (R-L2)', async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let fail: (error: Error) => void = () => undefined;
    sdf.readSdfJson.mockReturnValueOnce(new Promise((_, reject) => (fail = reject)));
    const document = readSigningDocument('tok', CONTRACT_ID);
    await vi.advanceTimersByTimeAsync(SIGNING_DOCUMENT_WAIT_MS - 1);
    expect(logged).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await document).toBeNull();
    expectOneRedactedLine(logged, 'signing document read failed');
    fail(leakyFailure());
    await vi.advanceTimersByTimeAsync(0);
    expect(logged).toHaveBeenCalledTimes(1);
  });
});
