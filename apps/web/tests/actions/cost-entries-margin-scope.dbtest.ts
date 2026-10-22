import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OrgContext } from '@/lib/db/context';
import { createCostEntryCore } from '@/lib/execution/costs/core';
import { loadCostEntriesCore } from '@/lib/execution/costs/reads';
import { NO_COST_FILTER, type CostEntriesFilter, type CostEntriesPage } from '@/lib/execution/costs/types';
import type { MemberRole } from '@/lib/permissions/roles';
import { closeExecutionFixture, ownerQuery, seedExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// Owner ruling (Oct 21) on the release-a5 security re-check, S1: a member who
// may not see margin (no `margin_pnl`, or a project manager while the studio
// hides margin from PMs) lists ONLY the cost entries it recorded and gets no
// totals, on every page and filter, so contract value minus the job's cost is
// no longer there to read. A member who may see margin keeps the full list
// and the totals. Recording is unchanged.

const STAFF: readonly MemberRole[] = ['owner', 'project_manager', 'site_engineer', 'accountant'];

/** One entry per member, each a figure no other entry (or total) contains. */
const AMOUNT_OF: Record<string, { typed: string; stored: string }> = {
  owner: { typed: '5444.44', stored: '5444.4400' },
  project_manager: { typed: '5123.45', stored: '5123.4500' },
  site_engineer: { typed: '1212.12', stored: '1212.1200' },
  accountant: { typed: '707.07', stored: '707.0700' },
};
const JOB_TOTAL = '12487.0800';

interface Studio {
  ctx: Record<string, OrgContext>;
  contractId: string;
  /** The entry id each member recorded. */
  entryOf: Record<string, string>;
}

const orgIds: string[] = [];
let hidden: Studio;
let shown: Studio;

async function seedStudio(hideMarginFromPm: boolean): Promise<Studio> {
  const org = await seedOrg({ owners: 1, members: STAFF.filter((role) => role !== 'owner').map((role) => ({ role })) });
  orgIds.push(org.orgId);
  await ownerQuery(`update public.organizations set hide_margin_from_pm = $2 where id = $1`, [org.orgId, hideMarginFromPm]);
  const ctx: Record<string, OrgContext> = { owner: ctxFor(org.orgId, org.ownerIds[0], 'owner') };
  STAFF.filter((role) => role !== 'owner').forEach((role, n) => {
    ctx[role] = ctxFor(org.orgId, org.memberIds[n], role);
  });
  const { contractId } = await seedExecutionContract(org.orgId, { state: 'signed' });
  const entryOf: Record<string, string> = {};
  for (const role of STAFF) {
    const written = await createCostEntryCore(ctx[role], {
      contractId,
      idempotencyKey: randomUUID(),
      category: 'materials',
      description: `Recorded by the ${role}`,
      amount: AMOUNT_OF[role].typed,
      incurredOn: '2026-10-01',
    });
    expect(written).toMatchObject({ ok: true, already: false });
    entryOf[role] = written.data as string;
  }
  return { ctx, contractId, entryOf };
}

beforeAll(async () => {
  hidden = await seedStudio(true);
  shown = await seedStudio(false);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

async function listAs(studio: Studio, role: MemberRole, filter: CostEntriesFilter = NO_COST_FILTER, cursor: unknown = null) {
  const answer = await loadCostEntriesCore(studio.ctx[role], { contractId: studio.contractId, filter, cursor });
  expect(answer.ok).toBe(true);
  return { page: answer.data as CostEntriesPage, said: JSON.stringify(answer) };
}

/** The page lists exactly `role`'s entry, no totals, and nothing of any other member's entries. */
function expectOnlyOwn(studio: Studio, role: MemberRole, page: CostEntriesPage, said: string) {
  expect(page.scope).toBe('own');
  expect(page.totals).toBeNull();
  expect(page.entries.map((entry) => entry.id)).toEqual([studio.entryOf[role]]);
  expect(page.entries[0]).toMatchObject({ amount: AMOUNT_OF[role].stored, editable: true });
  for (const other of STAFF.filter((member) => member !== role)) {
    expect(said).not.toContain(studio.entryOf[other]);
    expect(said).not.toContain(AMOUNT_OF[other].typed);
  }
  expect(said).not.toContain(JOB_TOTAL.slice(0, 8));
}

function expectEveryEntry(studio: Studio, page: CostEntriesPage) {
  expect(page.scope).toBe('all');
  expect(page.entries.map((entry) => entry.id).sort()).toEqual(STAFF.map((role) => studio.entryOf[role]).sort());
  expect(page.totals).toEqual({ count: STAFF.length, amount: JOB_TOTAL });
}

describe('whose cost entries a member lists (owner ruling Oct 21, S1)', () => {
  it('a project manager, with the studio hiding margin from PMs, lists only its own entries and no totals', async () => {
    const { page, said } = await listAs(hidden, 'project_manager');
    expectOnlyOwn(hidden, 'project_manager', page, said);
  });

  it('a project manager, with margin shown to PMs, lists every entry and the job total', async () => {
    const { page } = await listAs(shown, 'project_manager');
    expectEveryEntry(shown, page);
  });

  it.each([true, false])('a site engineer (no margin_pnl) lists only its own entries and no totals, whatever the PM toggle (hide=%s)', async (hide) => {
    const studio = hide ? hidden : shown;
    const { page, said } = await listAs(studio, 'site_engineer');
    expectOnlyOwn(studio, 'site_engineer', page, said);
  });

  it.each(['owner', 'accountant'] as const)('the %s keeps every entry and the job total, with the PM toggle on', async (role) => {
    const { page } = await listAs(hidden, role);
    expectEveryEntry(hidden, page);
  });

  it('the own scope holds on a later page and under a filter: still only the member\'s entries, still no totals', async () => {
    const afterEverything = { incurredOn: '2026-12-31', id: 'ffffffff-ffff-4fff-bfff-ffffffffffff' };
    const later = await listAs(hidden, 'project_manager', NO_COST_FILTER, afterEverything);
    expectOnlyOwn(hidden, 'project_manager', later.page, later.said);
    const filtered = await listAs(hidden, 'site_engineer', { category: 'materials', sectionId: null });
    expectOnlyOwn(hidden, 'site_engineer', filtered.page, filtered.said);
    const none = await listAs(hidden, 'site_engineer', { category: 'labour', sectionId: null });
    expect(none.page).toEqual({ entries: [], next: null, totals: null, scope: 'own' });
  });

  it('turning the toggle on narrows a project manager at once; turning it off gives the full view back', async () => {
    const orgId = shown.ctx.owner.orgId;
    try {
      await ownerQuery(`update public.organizations set hide_margin_from_pm = true where id = $1`, [orgId]);
      const narrowed = await listAs(shown, 'project_manager');
      expectOnlyOwn(shown, 'project_manager', narrowed.page, narrowed.said);
    } finally {
      await ownerQuery(`update public.organizations set hide_margin_from_pm = false where id = $1`, [orgId]);
    }
    expectEveryEntry(shown, (await listAs(shown, 'project_manager')).page);
  });
});
