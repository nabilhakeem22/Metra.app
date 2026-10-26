import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Execution tab's contract document, the reads (H6.2, AC19; the Workers
// CPU budget): every token SDF goes through lib/share/sdf-call, so the calls
// are counted at the one connection they share. Opening the document is ONE
// call, more sections ONE, a section's lines ONE; a refused ask is none.

const db = vi.hoisted(() => ({ calls: [] as string[], answers: {} as Record<string, unknown>, fails: false }));
const budget = vi.hoisted(() => ({ allowed: vi.fn(async () => true) }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/share/portal-rate-limit', () => ({ portalReadAllowed: budget.allowed }));
vi.mock('@/lib/db/client', () => ({
  DbWriteUncertainError: class DbWriteUncertainError extends Error {},
  withRequestDb: async (run: (handle: { execute: (query: unknown) => unknown }) => unknown) =>
    run({
      execute: (query: unknown) => {
        const name = /public\.(app_[a-z_]+)\(/.exec(JSON.stringify(query))?.[1] ?? 'unknown';
        db.calls.push(name);
        if (db.fails) throw new Error('connection reset');
        return [{ data: db.answers[name] ?? null }];
      },
    }),
}));

const { loadHomeContractSectionLines, loadHomeContractSections, openHomeContract } = await import('./contract-actions');

const CONTRACT_ID = '0b6f8e0c-2c1d-4c55-9c1a-6a1c8f0d0001';
const SECTION_ID = '0b6f8e0c-2c1d-4c55-9c1a-6a1c8f0d0002';

/** app_contract_by_token's snapshot, as the home's wrapper hands it on. */
const SNAPSHOT = {
  id: CONTRACT_ID,
  number: 4,
  status: 'issued',
  source: 'boq',
  terms_ar: 'الشروط',
  terms_en: 'Terms',
  lines_digest: 'ab'.repeat(32),
  org: { name_ar: 'نون', name_en: 'Noon', logo_file_id: null },
  discount_pct: '5.0000',
  discount_amount: '52.6316',
  taxable_base: '1000.0000',
  tax_rate: '14.0000',
  tax_amount: '140.0000',
  supervision_pct: '10.0000',
  supervision_amount: '100.0000',
  original_value: '1000.0000',
  total: '1240.0000',
  advance_pct: '0.0000',
  retention_pct: '0.0000',
  payment_schedule: [],
  section_count: 1,
  sections: [],
};

beforeEach(() => {
  budget.allowed.mockReset().mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  db.calls = [];
  db.answers = {};
  db.fails = false;
});

describe('opening the contract document', () => {
  it('is ONE call, app_home_contract_by_token, and hands over the document only', async () => {
    db.answers = { app_home_contract_by_token: SNAPSHOT };
    const answer = await openHomeContract('tok', CONTRACT_ID);
    expect(db.calls).toEqual(['app_home_contract_by_token']);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.contract.id).toBe(CONTRACT_ID);
    expect(answer.contract.total).toBe('1240.0000');
    // The BOQ's discount, so the figures add up to the works value (H6-read F3).
    expect(answer.contract).toMatchObject({ discount_pct: '5.0000', discount_amount: '52.6316' });
    for (const kept of ['terms_ar', 'terms_en', 'lines_digest', 'org', 'number', 'status']) expect(answer.contract).not.toHaveProperty(kept);
  });

  it('names the contract case-blind: the card id upper-cased still opens it', async () => {
    db.answers = { app_home_contract_by_token: SNAPSHOT };
    expect((await openHomeContract('tok', CONTRACT_ID.toUpperCase())).ok).toBe(true);
  });

  it('is gone when the link shows no contract, or another one than the card names', async () => {
    expect(await openHomeContract('tok', CONTRACT_ID)).toEqual({ ok: false, error: 'gone' });
    db.answers = { app_home_contract_by_token: { ...SNAPSHOT, id: SECTION_ID } };
    expect(await openHomeContract('tok', CONTRACT_ID)).toEqual({ ok: false, error: 'gone' });
  });

  it('past the read budget: too_many, and nothing is read', async () => {
    budget.allowed.mockResolvedValue(false);
    expect(await openHomeContract('tok', CONTRACT_ID)).toEqual({ ok: false, error: 'too_many' });
    expect(db.calls).toEqual([]);
  });

  it('a blank link reads nothing; a failure underneath is generic with a reference, never a throw', async () => {
    expect(await openHomeContract('  ', CONTRACT_ID)).toEqual({ ok: false, error: 'gone' });
    expect(db.calls).toEqual([]);
    db.fails = true;
    expect(await openHomeContract('tok', CONTRACT_ID)).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
  });
});

describe('more sections and a section lines', () => {
  it('more sections: ONE call, app_home_contract_sections_by_token', async () => {
    const page = { offset: 50, section_count: 60, sections: [] };
    db.answers = { app_home_contract_sections_by_token: page };
    expect(await loadHomeContractSections('tok', 50)).toEqual({ ok: true, page });
    expect(db.calls).toEqual(['app_home_contract_sections_by_token']);
  });

  it('a section lines: ONE call, app_home_contract_section_lines_by_token', async () => {
    const page = { section_id: SECTION_ID, offset: 0, line_count: 3, lines: [] };
    db.answers = { app_home_contract_section_lines_by_token: page };
    expect(await loadHomeContractSectionLines('tok', SECTION_ID, 0)).toEqual({ ok: true, page });
    expect(db.calls).toEqual(['app_home_contract_section_lines_by_token']);
  });

  it('a section of another contract is gone (the SQL answers null), as /c says it', async () => {
    expect(await loadHomeContractSectionLines('tok', SECTION_ID, 0)).toEqual({ ok: false, error: 'gone' });
    expect(db.calls).toEqual(['app_home_contract_section_lines_by_token']);
  });

  it('a forged section id or offset is gone with NO call', async () => {
    for (const [sectionId, offset] of [['not-a-uuid', 0], [SECTION_ID, -1], [SECTION_ID, 1.5], [SECTION_ID, 100_001]] as const) {
      expect(await loadHomeContractSectionLines('tok', sectionId, offset)).toEqual({ ok: false, error: 'gone' });
    }
    expect(await loadHomeContractSections('tok', -50)).toEqual({ ok: false, error: 'gone' });
    expect(db.calls).toEqual([]);
  });

  it('past the read budget: too_many, unread', async () => {
    budget.allowed.mockResolvedValue(false);
    expect(await loadHomeContractSections('tok', 50)).toEqual({ ok: false, error: 'too_many' });
    expect(await loadHomeContractSectionLines('tok', SECTION_ID, 0)).toEqual({ ok: false, error: 'too_many' });
    expect(db.calls).toEqual([]);
  });
});
