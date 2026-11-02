import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// F1 and F2 (lead rulings, Nov 2 2026): each dead end walked through the new act,
// on the same delivery row and the same token, through the real cores and the real
// database, with a FAKE sender and no Chromium. Each ends with a new issued version,
// X superseded, generate ok, the contract on the client's link, token_hash unchanged.

const outbox = vi.hoisted(() => ({ sent: [] as Array<{ code: string; homeUrl: string }> }));
vi.mock('@/lib/email/client-code', () => ({
  sendClientCodeEmail: async (input: { code: string; homeUrl: string }) => {
    outbox.sent.push(input);
    return { sent: true };
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest-client', 'cf-connecting-ip': '10.1.2.3' }) }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/boqs/issue/render', async () => ({
  renderAndStoreClientBoqPdf: (await import('./boq-new-version-fixture')).fakeClientPdf,
}));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.invalid';
});

import { loadBoqTab } from '@/app/[locale]/(app)/projects/[id]/boq-tab-data';
import { loadEngagementDetail } from '@/app/[locale]/(app)/engagements/[id]/engagement-detail-data';
import { requestClientCode } from '@/app/[locale]/d/[token]/code-actions';
import { signContractInHome } from '@/app/[locale]/d/[token]/contract-actions';
import { startBoqVersionCore } from '@/lib/boqs/core';
import { updateBoqLineCore } from '@/lib/boqs/edit';
import { issueBoqCore } from '@/lib/boqs/issue';
import { clientHomeAnswer } from '@/lib/client-home/home-link';
import { generateExecutionContractCore, issueContractCore, terminateContractCore } from '@/lib/contracts/core';
import { saveContractScheduleCore } from '@/lib/contracts/schedule/save';
import type { OrgContext } from '@/lib/db/context';
import { executeTransition } from '@/lib/engagements/executor';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { executionStage } from '@/lib/execution/stage';
import { boqContent, boqRow, firstLineOf } from './boq-new-version-fixture';
import { setClientEmail } from './client-home-fixture';
import { seedBoq, seedDelivery } from './contract-from-boq-fixture';
import { CHARGES, projectRows, SPLIT } from './design-first-fixture';
import { closeExecutionFixture, ownerQuery, seedClientProject } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const ORIGIN = 'https://studio.example';
const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let previousSecret: string | undefined;

beforeAll(async () => {
  previousSecret = process.env.SHARE_LINK_SECRET;
  process.env.SHARE_LINK_SECRET = 'df-share-link-secret-0123456789abcdef0123456789';
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
});

beforeEach(() => {
  outbox.sent.length = 0;
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

async function pairWithEmail() {
  const pair = await seedClientProject(orgId);
  await setClientEmail(orgId, pair.clientId, 'client@example.org');
  return pair;
}

/** The act, then the issue: X superseded by the new version, on the home. */
async function versionIssued(pair: { projectId: string }, x: string, home: string): Promise<string> {
  const started = await startBoqVersionCore(owner, x);
  expect(started).toMatchObject({ ok: true });
  const y = started.data!;
  expect(y).not.toBe(x);
  expect(await boqRow(y)).toMatchObject({ status: 'draft', engagement_id: home });
  expect(await issueBoqCore(owner, { boqId: y, locale: 'en' })).toMatchObject({ ok: true });
  expect(await boqRow(x)).toMatchObject({ status: 'superseded' });
  expect(await boqRow(y)).toMatchObject({ status: 'issued', engagement_id: home, supersedes_id: x });
  expect((await loadBoqTab(owner, pair.projectId)).boq?.id).toBe(y);
  return y;
}

/** Generate, schedule, issue and sign, all on the link the client already holds. */
async function contractOnLink(y: string, link: string): Promise<string> {
  const generated = await generate(y);
  expect(generated).toMatchObject({ ok: true });
  const contractId = generated.data!;
  expect(await saveContractScheduleCore(owner, { contractId, milestones: SPLIT })).toMatchObject({ ok: true });
  expect(await issueContractCore(owner, { id: contractId })).toMatchObject({ ok: true });
  expect(await clientHomeAnswer(owner, contractId, ORIGIN)).toMatchObject({ ok: true, link: `${ORIGIN}/en/d/${link}?tab=execution` });
  expect(await requestClientCode(link, { purpose: 'sign_contract', target: contractId })).toMatchObject({ ok: true });
  const [mail] = outbox.sent;
  expect(mail.homeUrl).toContain(`/d/${link}`);
  expect(await signContractInHome(link, { contractId, name: 'Client Name', code: mail.code })).toMatchObject({ ok: true });
  return contractId;
}

describe('the dead ends', () => {
  it('F1: a BOQ on an abandoned delivery, with a current delivery at execution', async () => {
    const pair = await pairWithEmail();
    const abandoned = await seedDelivery(orgId, pair, 'abandoned');
    const x = (await seedBoq(orgId, { project: pair, engagementId: abandoned })).boqId;
    const home = await seedDelivery(orgId, pair, 'execution');
    const link = (await mintDeliveryLinkCore(owner, home)).data!;
    const before = await projectRows(pair.projectId);

    expect(await generate(x)).toEqual({ ok: false, error: 'boq_not_on_home' });
    const tab = await loadBoqTab(owner, pair.projectId);
    expect(tab.execution).toMatchObject({ refusal: { code: 'boq_not_on_home' }, canStartVersion: true });

    const y = await versionIssued(pair, x, home);
    await contractOnLink(y, link);
    expect(await projectRows(pair.projectId)).toEqual(before);
  });

  it('F1: design only, continued, wanting a re-priced BOQ', async () => {
    const pair = await pairWithEmail();
    const home = await seedDelivery(orgId, pair, 'closed_design_only');
    const link = (await mintDeliveryLinkCore(owner, home)).data!;
    const x = (await seedBoq(orgId, { project: pair, engagementId: home })).boqId;
    const [{ token_hash: tokenHash }] = await projectRows(pair.projectId);
    expect((await startBoqVersionCore(owner, x)).error).toBe('design_only_closed');
    expect(await executeTransition(owner, { engagementId: home, trigger: 'continueToExecution' })).toMatchObject({ ok: true });
    expect((await loadBoqTab(owner, pair.projectId)).execution).toMatchObject({ refusal: null, canGenerate: true, canStartVersion: true });

    const started = await startBoqVersionCore(owner, x);
    const pricedAt = (await boqContent(x)).header.total;
    expect(await updateBoqLineCore(owner, { lineId: await firstLineOf(started.data!), patch: { unitPrice: '900' } })).toMatchObject({ ok: true });
    expect((await boqContent(started.data!)).header.total).not.toBe(pricedAt);

    const y = await versionIssued(pair, x, home);
    expect(y).toBe(started.data);
    const contractId = await contractOnLink(y, link);
    const [contract] = await ownerQuery<{ source_boq_id: string; taxable_base: string }>(`select source_boq_id, taxable_base::text from public.contracts where id = $1`, [contractId]);
    expect(contract.source_boq_id).toBe(y);
    expect(contract.taxable_base).not.toBe(pricedAt);
    expect(await projectRows(pair.projectId)).toEqual([expect.objectContaining({ id: home, state: 'execution', token_hash: tokenHash })]);
  });

  it('F2: a terminated contract: the cockpit points at the tab, and a new contract goes out on the same link', async () => {
    const pair = await pairWithEmail();
    const home = await seedDelivery(orgId, pair, 'execution');
    const link = (await mintDeliveryLinkCore(owner, home)).data!;
    const x = (await seedBoq(orgId, { project: pair, engagementId: home })).boqId;
    const before = await projectRows(pair.projectId);
    const old = (await generate(x)).data!;
    expect(await saveContractScheduleCore(owner, { contractId: old, milestones: SPLIT })).toMatchObject({ ok: true });
    expect(await issueContractCore(owner, { id: old })).toMatchObject({ ok: true });
    expect(await startBoqVersionCore(owner, x)).toEqual({ ok: false, error: 'boq_has_contract' });
    expect(await terminateContractCore(owner, { id: old })).toMatchObject({ ok: true });

    const cockpit = await loadEngagementDetail(owner, home);
    expect(executionStage(cockpit!.execution!.flow.stage)).toEqual({ stage: 'terminated', next: { kind: 'open_boq' } });
    expect((await loadBoqTab(owner, pair.projectId)).execution).toMatchObject({ contractId: old, canStartVersion: true, refusal: null });
    expect(await generate(x)).toEqual({ ok: false, error: 'contract_exists' });

    const y = await versionIssued(pair, x, home);
    const fresh = await contractOnLink(y, link);
    expect((await loadEngagementDetail(owner, home))?.execution?.contract).toMatchObject({ id: fresh, status: 'signed' });
    expect(await projectRows(pair.projectId)).toEqual(before);
  });
});
