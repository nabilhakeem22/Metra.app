import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Lead ruling R-F1: while a draft stands on the project, generate on the issued BOQ
// is refused, so it cannot make the contract that would stop the draft being issued.
// The real cores on the real database, no Chromium.

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest-client', 'cf-connecting-ip': '10.1.2.3' }) }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/boqs/issue/render', async () => ({
  renderAndStoreClientBoqPdf: (await import('./boq-new-version-fixture')).fakeClientPdf,
}));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.invalid';
});

import { loadEngagementDetail } from '@/app/[locale]/(app)/engagements/[id]/engagement-detail-data';
import { loadBoqTab } from '@/app/[locale]/(app)/projects/[id]/boq-tab-data';
import { startBoqVersionCore } from '@/lib/boqs/core';
import { issueBoqCore } from '@/lib/boqs/issue';
import { getProjectBoqSummary } from '@/lib/boqs/queries';
import { generateExecutionContractCore } from '@/lib/contracts/core';
import type { OrgContext } from '@/lib/db/context';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { executionStage } from '@/lib/execution/stage';
import { boqRow, draftsOf } from './boq-new-version-fixture';
import { seedBoq, seedDelivery } from './contract-from-boq-fixture';
import { CHARGES, projectRows, targetOf } from './design-first-fixture';
import { closeExecutionFixture, ownerQuery, seedClientProject, seedExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let manager: OrgContext;
let previousSecret: string | undefined;

beforeAll(async () => {
  previousSecret = process.env.SHARE_LINK_SECRET;
  process.env.SHARE_LINK_SECRET = 'df-share-link-secret-0123456789abcdef0123456789';
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }] });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  manager = ctxFor(orgId, seeded.memberIds[0], 'project_manager');
});

afterAll(async () => {
  if (previousSecret === undefined) delete process.env.SHARE_LINK_SECRET;
  else process.env.SHARE_LINK_SECRET = previousSecret;
  delete process.env.NEXT_PUBLIC_APP_URL;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const generate = (boqId: string) => generateExecutionContractCore(owner, { boqId, ...CHARGES });

/** An issued BOQ on the home of a fresh pair. */
async function issuedAtHome() {
  const pair = await seedClientProject(orgId);
  const home = await seedDelivery(orgId, pair, 'execution');
  const { boqId: x } = await seedBoq(orgId, { project: pair, engagementId: home });
  return { pair, home, x };
}

async function contractsOn(projectId: string): Promise<string[]> {
  const rows = await ownerQuery<{ id: string }>(`select id from public.contracts where project_id = $1`, [projectId]);
  return rows.map((row) => row.id);
}

async function lastContractNumber(): Promise<number> {
  const [{ last }] = await ownerQuery<{ last: number }>(`select coalesce(max(number), 0)::int as last from public.contracts where org_id = $1`, [orgId]);
  return last;
}

describe('generate on X while its draft version stands', () => {
  it('boq_version_in_progress: no contract, and no number spent', async () => {
    const { pair, x } = await issuedAtHome();
    const d = (await startBoqVersionCore(owner, x)).data!;
    const numberBefore = await lastContractNumber();

    expect(await generate(x)).toEqual({ ok: false, error: 'boq_version_in_progress' });

    expect(await contractsOn(pair.projectId)).toEqual([]);
    expect(await lastContractNumber()).toBe(numberBefore);
    expect(await boqRow(x)).toMatchObject({ status: 'issued' });
    expect(await boqRow(d)).toMatchObject({ status: 'draft' });
    const other = await issuedAtHome();
    const next = (await generate(other.x)).data!;
    const [{ number }] = await ownerQuery<{ number: number }>(`select number from public.contracts where id = $1`, [next]);
    expect(number).toBe(numberBefore + 1);
  });

  it('D issued, then generate on D works: the same delivery, token_hash unchanged, X now boq_not_issued', async () => {
    const { pair, home, x } = await issuedAtHome();
    await mintDeliveryLinkCore(owner, home);
    const before = await projectRows(pair.projectId);
    const d = (await startBoqVersionCore(owner, x)).data!;
    expect(await generate(x)).toEqual({ ok: false, error: 'boq_version_in_progress' });

    expect(await issueBoqCore(owner, { boqId: d, locale: 'en' })).toMatchObject({ ok: true });
    expect(await generate(x)).toEqual({ ok: false, error: 'boq_not_issued' });
    const generated = await generate(d);
    expect(generated).toMatchObject({ ok: true });

    const [contract] = await ownerQuery<{ source_boq_id: string }>(`select source_boq_id from public.contracts where id = $1`, [generated.data]);
    expect(contract.source_boq_id).toBe(d);
    expect(await boqRow(d)).toMatchObject({ status: 'issued', engagement_id: home, supersedes_id: x });
    expect(before[0].token_hash).toBeTruthy();
    expect(await projectRows(pair.projectId)).toEqual(before);
    expect((await loadEngagementDetail(owner, home))?.execution?.contract?.id).toBe(generated.data);
  });

  it('racing the act, 20 rounds: one of them wins, the loser says why, and never both a contract and a live draft', async () => {
    for (let round = 0; round < 20; round += 1) {
      const { pair, x } = await issuedAtHome();
      // Which reaches the row lock first flips with who is sent first.
      const [generated, started] =
        round % 2 === 0
          ? await Promise.all([generate(x), startBoqVersionCore(owner, x)])
          : (await Promise.all([startBoqVersionCore(owner, x), generate(x)])).reverse();
      const label = `round ${String(round)}`;
      const [contracts, drafts] = [await contractsOn(pair.projectId), await draftsOf(pair.projectId)];
      if (generated.ok) {
        expect(started, label).toEqual({ ok: false, error: 'boq_has_contract' });
        expect(contracts, label).toEqual([generated.data]);
        expect(drafts, label).toEqual([]);
      } else {
        expect(generated, label).toEqual({ ok: false, error: 'boq_version_in_progress' });
        expect(started, label).toMatchObject({ ok: true });
        expect(contracts, label).toEqual([]);
        expect(drafts, label).toEqual([started.data]);
      }
    }
  });
});

describe('what the cockpit and the tab read', () => {
  it('a draft on the project is on the summary; the flow facts stay on X and say Create, as the client home derives them', async () => {
    const { pair, home, x } = await issuedAtHome();
    expect((await getProjectBoqSummary(owner, pair.projectId))?.projectHasDraft).toBe(false);
    const clean = await loadEngagementDetail(owner, home);
    await startBoqVersionCore(owner, x);

    const summary = await getProjectBoqSummary(owner, pair.projectId);
    expect(summary).toMatchObject({ id: x, status: 'issued', projectHasDraft: true });
    const detail = await loadEngagementDetail(owner, home);
    expect(detail?.boqStep.current?.projectHasDraft).toBe(true);
    expect(detail?.execution).toEqual(clean?.execution);
    expect(executionStage(detail!.execution!.flow.stage)).toEqual({ stage: 'no_contract', next: { kind: 'create_contract' } });
  });

  it.each(['owner', 'manager'] as const)("the tab's Create stays hidden for the %s: the draft is in front", async (who) => {
    const { pair, x } = await issuedAtHome();
    const d = (await startBoqVersionCore(owner, x)).data!;
    const tab = await loadBoqTab(who === 'owner' ? owner : manager, pair.projectId);
    expect(tab.boq).toMatchObject({ id: d, status: 'draft' });
    expect(tab.execution).toEqual({ contractId: null, canGenerate: false, refusal: null, canStartVersion: false });
  });
});

describe('the normal paths', () => {
  it('X issued with no draft still generates', async () => {
    const { pair, x } = await issuedAtHome();
    const generated = await generate(x);
    expect(generated).toMatchObject({ ok: true });
    expect(await contractsOn(pair.projectId)).toEqual([generated.data]);
  });

  it('a draft only, no issued BOQ: boq_not_issued as before, and the cockpit says open the BOQ', async () => {
    const pair = await seedClientProject(orgId);
    const home = await seedDelivery(orgId, pair, 'execution');
    const { boqId } = await seedBoq(orgId, { project: pair, engagementId: home, state: 'draft' });
    expect(await generate(boqId)).toEqual({ ok: false, error: 'boq_not_issued' });
    expect((await getProjectBoqSummary(owner, pair.projectId))?.projectHasDraft).toBe(true);
    const detail = await loadEngagementDetail(owner, home);
    expect(executionStage(detail!.execution!.flow.stage)).toEqual({ stage: 'no_boq', next: { kind: 'open_boq' } });
  });

  it('a draft beside a contract: contract_exists as before, and the contract stays', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'execution');
    const contract = await seedExecutionContract(orgId, { state: 'draft', delivery: { id, ...pair } });
    await seedBoq(orgId, { project: pair, state: 'draft', deliveryState: null });
    expect(await generate(contract.boqId)).toEqual({ ok: false, error: 'contract_exists' });
    expect(await contractsOn(pair.projectId)).toEqual([contract.contractId]);
    const tab = await loadBoqTab(owner, pair.projectId);
    expect(tab.boq?.id).toBe(contract.boqId);
    expect(tab.execution.contractId).toBe(contract.contractId);
  });

  it('design still open beside a draft: design_open still comes first', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'execution_decision');
    const { boqId } = await seedBoq(orgId, { project: pair, engagementId: id });
    await seedBoq(orgId, { project: pair, state: 'draft', deliveryState: null });
    expect(await generate(boqId)).toEqual({ ok: false, error: 'design_open', params: await targetOf(id) });
  });
});
