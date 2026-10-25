import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import type { MemberRole } from '@/lib/permissions/roles';

vi.mock('server-only', () => ({}));

// The read is replaced so the property this module owns can be asserted: a role
// D1 never admits costs NO query, which a database cannot be asked about.
const loadRescueLedgerRows = vi.fn();
vi.mock('./queries', () => ({ loadRescueLedgerRows: (...args: unknown[]) => loadRescueLedgerRows(...args) }));

const { loadRescueLedgerCore } = await import('./core');

const ctxAs = (role: MemberRole): OrgContext => ({ orgId: 'org-1', userId: 'user-1', role });

beforeEach(() => {
  loadRescueLedgerRows.mockReset();
  loadRescueLedgerRows.mockResolvedValue({ restrictFirmDashboard: false, rows: [] });
});

describe('loadRescueLedgerCore', () => {
  it.each(['project_manager', 'site_engineer', 'viewer', 'client'] as const)('refuses %s before any query', async (role) => {
    expect(await loadRescueLedgerCore(ctxAs(role), { range: 6 })).toEqual({ ok: false, error: 'forbidden' });
    expect(loadRescueLedgerRows).not.toHaveBeenCalled();
  });

  it('asks the statement to withhold the ledger only for a role the limit narrows out', async () => {
    await loadRescueLedgerCore(ctxAs('owner'), { range: 6 });
    await loadRescueLedgerCore(ctxAs('admin'), { range: 6 });
    await loadRescueLedgerCore(ctxAs('accountant'), { range: 12 });
    expect(loadRescueLedgerRows.mock.calls.map(([, range, withheld]) => [range, withheld])).toEqual([
      [6, false],
      [6, false],
      [12, true],
    ]);
  });

  it('refuses the accountant when the statement read the limit as on', async () => {
    loadRescueLedgerRows.mockResolvedValue({ restrictFirmDashboard: true, rows: [] });
    expect(await loadRescueLedgerCore(ctxAs('accountant'), { range: 6 })).toEqual({ ok: false, error: 'forbidden' });
    expect((await loadRescueLedgerCore(ctxAs('owner'), { range: 6 })).ok).toBe(true);
  });

  it('shapes the rows into the contract', async () => {
    loadRescueLedgerRows.mockResolvedValue({
      restrictFirmDashboard: false,
      rows: [{ risk: 'r4', month: null, events: 2, deliveries: 1, amount: '900.0000', followups: null }],
    });
    const result = await loadRescueLedgerCore(ctxAs('owner'), { range: 3 });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.heldFees).toEqual({ amount: '900.0000', payments: 2, deliveries: 1 });
    expect(result.data.months).toHaveLength(3);
  });

  it('answers a failed read generic with a reference, and logs no raw error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadRescueLedgerRows.mockRejectedValue(Object.assign(new Error('Failed query: select secret'), { query: 'select', params: ['x'] }));
    const result = await loadRescueLedgerCore(ctxAs('owner'), { range: 6 });
    expect(result).toMatchObject({ ok: false, error: 'generic', reference: expect.stringMatching(/\S/) });
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
    log.mockRestore();
  });
});
