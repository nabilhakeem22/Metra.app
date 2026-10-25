// The contract and proposal registers, a page of 25 at a time: the count and
// the page in one transaction, the search and filters applied in the database
// across every row (not just the page on screen), and a page past the end read
// as the last page. Rows are inserted in bulk over the BYPASSRLS connection;
// the reads go through the app's RLS path (withOrgContext), as the pages do.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { listContractsPage } from '@/lib/contracts/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { listProposalsPage } from '@/lib/proposals/queries';
import type { OrgContext } from '@/lib/db/context';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

interface Studio {
  ctx: OrgContext;
  orgId: string;
}

async function studio(): Promise<Studio & { clientId: string; projectId: string }> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01', endDate: '2026-06-30',
    code: 'PRJ-1', nameEn: 'Tower', clientId: client.id, status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  return { ctx, orgId, clientId: client.id, projectId: project.id };
}

/**
 * `count` quotes numbered 1..count: odd ones titled "Villa", even ones "Tower"
 * (no digit in a title, so a number search matches numbers only); number 7 also
 * carries an Arabic title with a hamza. `accepted` of the newest are accepted.
 */
async function insertProposals(
  { orgId, clientId, projectId }: { orgId: string; clientId: string; projectId: string },
  count: number,
): Promise<void> {
  await raw.query(`
    insert into public.proposals (org_id, number, title_en, title_ar, client_id, project_id, status, kind)
    select '${orgId}', n,
           case when n % 2 = 1 then 'Villa' else 'Tower' end,
           case when n = 7 then 'فيلا أحمد' end,
           '${clientId}', '${projectId}', 'accepted', 'quote'
    from generate_series(1, ${count}) as n`);
}

/** One contract per proposal 1..count, numbered as its proposal; numbers above `issuedAbove` issued. */
async function insertContracts(
  { orgId, clientId, projectId }: { orgId: string; clientId: string; projectId: string },
  count: number,
  issuedAbove: number,
): Promise<void> {
  await raw.query(`
    insert into public.contracts (org_id, number, title_en, source_proposal_id, client_id, project_id, status)
    select '${orgId}', p.number, 'Contract', p.id, '${clientId}', '${projectId}',
           (case when p.number > ${issuedAbove} then 'issued' else 'draft' end)::contract_status
    from public.proposals p
    where p.org_id = '${orgId}' and p.number <= ${count}`);
}

const numbers = (rows: Array<{ number: number }>) => rows.map((row) => row.number);
/** Numbers from `from` down to `to`, as the register orders them. */
const descending = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);

describe('the proposal register, a page at a time', () => {
  let seeded: Studio;

  beforeAll(async () => {
    const studioA = await studio();
    await insertProposals(studioA, 60);
    seeded = studioA;
    // Another studio's proposals never count here.
    const studioB = await studio();
    await insertProposals(studioB, 7);
  });

  it('page 1 is the newest 25, page 2 rows 26 to 50, with the total', async () => {
    const first = await listProposalsPage(seeded.ctx, { page: 1 });
    expect(first.total).toBe(60);
    expect(first.page).toBe(1);
    expect(numbers(first.rows)).toEqual(descending(60, 36));

    const second = await listProposalsPage(seeded.ctx, { page: 2 });
    expect(second.total).toBe(60);
    expect(second.page).toBe(2);
    expect(numbers(second.rows)).toEqual(descending(35, 11));

    const third = await listProposalsPage(seeded.ctx, { page: 3 });
    expect(numbers(third.rows)).toEqual(descending(10, 1));
  });

  it('a page past the end shows the last page; below 1 shows the first', async () => {
    const past = await listProposalsPage(seeded.ctx, { page: 99 });
    expect(past.page).toBe(3);
    expect(past.total).toBe(60);
    expect(numbers(past.rows)).toEqual(descending(10, 1));
    expect((await listProposalsPage(seeded.ctx, { page: 0 })).page).toBe(1);
  });

  it('a search covers every proposal, not one page, and pages with it', async () => {
    const villas = await listProposalsPage(seeded.ctx, { q: 'villa', page: 2 });
    expect(villas.total).toBe(30);
    expect(villas.page).toBe(2);
    expect(numbers(villas.rows)).toEqual([9, 7, 5, 3, 1]);
    expect(villas.rows.every((row) => row.titleEn === 'Villa')).toBe(true);

    const pastTheEnd = await listProposalsPage(seeded.ctx, { q: 'VILLA', page: 5 });
    expect(pastTheEnd.page).toBe(2);
    expect(numbers(pastTheEnd.rows)).toEqual([9, 7, 5, 3, 1]);
  });

  it('a search matches a quote number, and every typed word', async () => {
    const twelve = await listProposalsPage(seeded.ctx, { q: '12', page: 1 });
    expect(numbers(twelve.rows)).toEqual([12]);
    const ones = await listProposalsPage(seeded.ctx, { q: '1', page: 1 });
    expect(ones.total).toBe(15); // 1, 10..19, 21, 31, 41, 51
    const both = await listProposalsPage(seeded.ctx, { q: 'villa 1', page: 1 });
    expect(numbers(both.rows)).toEqual([51, 41, 31, 21, 19, 17, 15, 13, 11, 1]);
  });

  it('an Arabic search folds hamza spellings', async () => {
    const found = await listProposalsPage(seeded.ctx, { q: 'احمد', page: 1 });
    expect(numbers(found.rows)).toEqual([7]);
    expect(found.total).toBe(1);
  });

  it('a search that matches nothing still knows the studio has proposals', async () => {
    const none = await listProposalsPage(seeded.ctx, { q: 'nothing like this', page: 3 });
    expect(none).toEqual({ rows: [], total: 0, page: 1, hasAnyProposal: true });
  });

  it('a search of LIKE wildcards is taken literally', async () => {
    expect((await listProposalsPage(seeded.ctx, { q: '%', page: 1 })).total).toBe(0);
    expect((await listProposalsPage(seeded.ctx, { q: '_', page: 1 })).total).toBe(0);
  });

  it('a studio with no proposal at all has none to offer', async () => {
    const empty = await studio();
    const page = await listProposalsPage(empty.ctx, { page: 1 });
    expect(page).toEqual({ rows: [], total: 0, page: 1, hasAnyProposal: false });
    const searched = await listProposalsPage(empty.ctx, { q: 'villa', page: 1 });
    expect(searched.hasAnyProposal).toBe(false);
  });
});

describe('the contract register, a page at a time', () => {
  let seeded: Studio;

  beforeAll(async () => {
    const studioA = await studio();
    await insertProposals(studioA, 60);
    await insertContracts(studioA, 55, 20);
    seeded = studioA;
    const studioB = await studio();
    await insertProposals(studioB, 4);
    await insertContracts(studioB, 4, 0);
  });

  it('page 2 is rows 26 to 50, with the total', async () => {
    const first = await listContractsPage(seeded.ctx, { page: 1 });
    expect(first.total).toBe(55);
    expect(numbers(first.rows)).toEqual(descending(55, 31));
    const second = await listContractsPage(seeded.ctx, { page: 2 });
    expect(second.total).toBe(55);
    expect(second.page).toBe(2);
    expect(numbers(second.rows)).toEqual(descending(30, 6));
    expect(second.rows[0]).toMatchObject({ clientNameEn: 'Acme', projectNameEn: 'Tower', status: 'issued' });
  });

  it('a page past the end shows the last page', async () => {
    const past = await listContractsPage(seeded.ctx, { page: 40 });
    expect(past.page).toBe(3);
    expect(numbers(past.rows)).toEqual(descending(5, 1));
  });

  it('a filter and the page together: the count is of the filtered rows', async () => {
    const issued = await listContractsPage(seeded.ctx, { status: 'issued', page: 2 });
    expect(issued.total).toBe(35);
    expect(issued.page).toBe(2);
    expect(numbers(issued.rows)).toEqual(descending(30, 21));
    const drafts = await listContractsPage(seeded.ctx, { status: 'draft', page: 9 });
    expect(drafts.total).toBe(20);
    expect(drafts.page).toBe(1);
    expect(numbers(drafts.rows)).toEqual(descending(20, 1));
  });

  it('a studio with no contract has an empty first page', async () => {
    const empty = await studio();
    expect(await listContractsPage(empty.ctx, { page: 4 })).toEqual({ rows: [], total: 0, page: 1 });
  });
});
