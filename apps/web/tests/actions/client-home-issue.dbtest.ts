import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// H6.4 end to end (AC15, AC26/27 through the issue): issuing an execution
// contract hands the studio its client home, as the issue action runs it
// (issueContractCore, then clientHomeAnswer), against the real database: ONE
// light delivery when no delivery stands behind the BOQ, the design delivery
// when one does, never a second one on a race or a retry, and nothing for a
// role that may not issue.

vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));

import { clientHomeAnswer } from '@/lib/client-home/home-link';
import { getHomeByToken } from '@/lib/client-home/read';
import { contractHomeRedirect } from '@/lib/client-home/redirect';
import type { ClientHomeAnswer } from '@/lib/client-home/types';
import { issueContractCore } from '@/lib/contracts/core';
import type { OrgContext } from '@/lib/db/context';
import { seedBillableContract } from './execution-billing-fixture';
import { closeExecutionFixture, ownerQuery } from './execution-fixture';
import { seedDelivery } from './delivery-execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const ORIGIN = 'https://studio.example';
const orgIds: string[] = [];
let owner: OrgContext;
let manager: OrgContext;

beforeAll(async () => {
  process.env.SHARE_LINK_SECRET = 'h64-share-link-secret-0123456789abcdef0123456789';
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }] });
  owner = ctxFor(seeded.orgId, seeded.ownerIds[0], 'owner');
  manager = ctxFor(seeded.orgId, seeded.memberIds[0], 'project_manager');
  orgIds.push(seeded.orgId);
});

afterAll(async () => {
  delete process.env.SHARE_LINK_SECRET;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** What issueContract does for an execution contract: the issue, then its home. */
async function issueThenHome(ctx: OrgContext, contractId: string) {
  const issued = await issueContractCore(ctx, { id: contractId });
  if (!issued.ok || !issued.data?.execution) return { issued, home: null };
  return { issued, home: await clientHomeAnswer(ctx, contractId, ORIGIN) };
}

const deliveriesOf = async (projectId: string) =>
  ownerQuery<{ id: string; entry_phase: string }>(`select id, entry_phase from public.design_engagements where project_id = $1`, [projectId]);

/** The raw home token inside the Execution tab URL the studio is handed. */
function homeRawOf(home: ClientHomeAnswer | null): string {
  if (!home?.ok || home.link === null) throw new Error(`no home link: ${JSON.stringify(home)}`);
  const match = /^https:\/\/studio\.example\/en\/d\/([^?]+)\?tab=execution$/.exec(home.link);
  if (!match) throw new Error('unexpected home link shape');
  return match[1];
}

describe('issuing an execution contract hands out its home', () => {
  it('no delivery behind the BOQ: ONE light delivery, whose link opens the signing, and the /c link leads there', async () => {
    const contract = await seedBillableContract(owner.orgId, 'draft');
    const { issued, home } = await issueThenHome(owner, contract.contractId);
    expect(issued).toEqual({ ok: true, data: { rawToken: expect.any(String), execution: true } });
    const rows = await deliveriesOf(contract.projectId);
    expect(rows).toEqual([{ id: expect.any(String), entry_phase: 'execution' }]);
    const homeRaw = homeRawOf(home);
    const read = await getHomeByToken(homeRaw);
    expect(read.status === 'ok' && read.home.execution?.location.reason).toBe('sign_contract');
    expect(await contractHomeRedirect(issued.data!.rawToken, 'en')).toBe(`/en/d/${homeRaw}?tab=execution&focus=contract`);
  });

  it('a BOQ of a design delivery: that delivery, no new row', async () => {
    const delivery = await seedDelivery(owner.orgId);
    const contract = await seedBillableContract(owner.orgId, 'draft', delivery);
    const { home } = await issueThenHome(owner, contract.contractId);
    expect(home?.ok).toBe(true);
    expect((await deliveriesOf(contract.projectId)).map((row) => row.id)).toEqual([delivery.id]);
  });

  it('two issues at once: one ok, one contract_not_draft, one light delivery', async () => {
    const contract = await seedBillableContract(owner.orgId, 'draft');
    const answers = await Promise.all([issueThenHome(owner, contract.contractId), issueThenHome(owner, contract.contractId)]);
    expect(answers.map(({ issued }) => issued.ok ? 'ok' : issued.error).sort()).toEqual(['contract_not_draft', 'ok']);
    expect(await deliveriesOf(contract.projectId)).toHaveLength(1);
  });

  it("then the Client page control's answer: the same link, no second delivery", async () => {
    const contract = await seedBillableContract(owner.orgId, 'draft');
    const { home } = await issueThenHome(owner, contract.contractId);
    expect(await clientHomeAnswer(owner, contract.contractId, ORIGIN)).toEqual(home);
    expect(await deliveriesOf(contract.projectId)).toHaveLength(1);
  });

  it('a project manager may not issue: forbidden, and no delivery is made', async () => {
    const contract = await seedBillableContract(owner.orgId, 'draft');
    expect(await issueThenHome(manager, contract.contractId)).toEqual({ issued: { ok: false, error: 'forbidden' }, home: null });
    expect(await deliveriesOf(contract.projectId)).toEqual([]);
  });
});
