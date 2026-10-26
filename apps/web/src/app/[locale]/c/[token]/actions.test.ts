import { beforeEach, describe, expect, test, vi } from 'vitest';

// PR A3.6, AC11: /c's "show more" reads spend the link's read budget; past it,
// or for a section that answers nothing, the answer says so, and the action
// never throws to the page. A3 reliability R1: "show more sections" likewise.

vi.mock('server-only', () => ({}));
const reads = vi.hoisted(() => ({ allowed: vi.fn(async () => true), page: vi.fn(), sections: vi.fn() }));
vi.mock('@/lib/share/portal-rate-limit', () => ({ portalReadAllowed: reads.allowed }));
vi.mock('@/lib/contracts/public', () => ({
  getContractSectionLinesByToken: reads.page,
  getContractSectionsByToken: reads.sections,
  acknowledgeContractByToken: vi.fn(),
  contractPayloadHash: vi.fn(),
  getContractByToken: vi.fn(),
}));
vi.mock('@/lib/share/request-provenance', () => ({ requestProvenance: async () => ({ ip: null, userAgent: null }) }));

const { loadContractSectionLines, loadContractSections } = await import('./actions');

beforeEach(() => {
  reads.allowed.mockReset().mockResolvedValue(true);
  reads.page.mockReset();
  reads.sections.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadContractSectionLines', () => {
  test('past the read budget: too_many, and the page is never read', async () => {
    reads.allowed.mockResolvedValue(false);
    expect(await loadContractSectionLines('t', 's-1', 50)).toEqual({ ok: false, error: 'too_many' });
    expect(reads.page).not.toHaveBeenCalled();
  });

  test('a section that answers nothing is gone; a failure underneath is generic with a reference', async () => {
    reads.page.mockResolvedValue(null);
    expect(await loadContractSectionLines('t', 's-x', 0)).toEqual({ ok: false, error: 'gone' });
    reads.page.mockRejectedValue(new Error('boom'));
    expect(await loadContractSectionLines('t', 's-1', 0)).toMatchObject({ ok: false, error: 'generic', reference: expect.any(String) });
  });
});

describe('loadContractSections', () => {
  test('past the read budget: too_many, unread; nothing to show: gone', async () => {
    reads.allowed.mockResolvedValueOnce(false);
    expect(await loadContractSections('t', 50)).toEqual({ ok: false, error: 'too_many' });
    expect(reads.sections).not.toHaveBeenCalled();
    reads.sections.mockResolvedValue(null);
    expect(await loadContractSections('t', 50)).toEqual({ ok: false, error: 'gone' });
  });
});
