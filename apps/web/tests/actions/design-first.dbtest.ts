import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// AC19, end to end: the exact "شقة الرحاب 2" scenario, one test per part, through
// the real cores and the real database, with a FAKE sender in place of the email:
// Resend is never reached from a test. One project, one client, one row, one link.

const outbox = vi.hoisted(() => ({ sent: [] as Array<{ to: string; code: string; homeUrl: string }> }));
vi.mock('@/lib/email/client-code', () => ({
  sendClientCodeEmail: async (input: { to: string; code: string; homeUrl: string }) => {
    outbox.sent.push(input);
    return { sent: true };
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest-client', 'cf-connecting-ip': '10.1.2.3' }) }));
vi.mock('next-intl/server', () => ({ getLocale: async () => 'en' }));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.invalid';
});

import { loadEngagementDetail } from '@/app/[locale]/(app)/engagements/[id]/engagement-detail-data';
import { requestClientCode } from '@/app/[locale]/d/[token]/code-actions';
import { signContractInHome } from '@/app/[locale]/d/[token]/contract-actions';
import { ensureClientHomeCore } from '@/lib/client-home/ensure';
import { clientHomeAnswer } from '@/lib/client-home/home-link';
import { generateExecutionContractCore, issueContractCore } from '@/lib/contracts/core';
import { saveContractScheduleCore } from '@/lib/contracts/schedule/save';
import type { OrgContext } from '@/lib/db/context';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { endingChoicesFrom } from '@/lib/engagements/forward-trigger';
import { recordHandoffAndCloseCore } from '@/lib/engagements/handover-close';
import { getEngagementByProject } from '@/lib/engagements/queries/by-project';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { seedBoq, seedDelivery } from './contract-from-boq-fixture';
import { CHARGES, projectRows, SPLIT, targetOf } from './design-first-fixture';
import { setClientEmail } from './client-home-fixture';
import { closeExecutionFixture, ownerQuery, seedClientProject, seedExecutionContract } from './execution-fixture';
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

/** شقة الرحاب 2: one project and one client, its email on file. */
async function rehab2(): Promise<{ clientId: string; projectId: string }> {
  const pair = await seedClientProject(orgId);
  await ownerQuery(`update public.projects set name_ar = 'شقة الرحاب 2', name_en = 'Rehab flat 2' where id = $1`, [pair.projectId]);
  await setClientEmail(orgId, pair.clientId, 'client@example.org');
  return pair;
}

const create = (pair: { clientId: string; projectId: string }) => createEngagementCore(owner, pair);
const generate = (boqId: string) => generateExecutionContractCore(owner, { boqId, ...CHARGES });
const fire = (engagementId: string, trigger: 'chooseExecution' | 'chooseDesignOnly' | 'continueToExecution') =>
  executeTransition(owner, { engagementId, trigger });
const TAKEN = (delivery: string) => ({ ok: false, error: 'check_fields', fields: { projectId: { code: 'project_client_has_delivery', params: { delivery } } } });
const ACTIVE = { ok: false, error: 'check_fields', fields: { projectId: { code: 'project_delivery_exists' } } };

/** Generate, schedule, issue: the issue's answer carries the link the client already holds. */
async function contractOnLink(boqId: string, link: string): Promise<string> {
  const generated = await generate(boqId);
  expect(generated).toMatchObject({ ok: true });
  const contractId = generated.data!;
  expect(await saveContractScheduleCore(owner, { contractId, milestones: SPLIT })).toMatchObject({ ok: true });
  expect(await issueContractCore(owner, { id: contractId })).toMatchObject({ ok: true, data: { execution: true } });
  const home = await clientHomeAnswer(owner, contractId, ORIGIN);
  expect(home).toMatchObject({ ok: true, link: `${ORIGIN}/en/d/${link}?tab=execution` });
  return contractId;
}

/** The client's code and signature, through the link and only the link. */
async function signOnLink(link: string, contractId: string): Promise<void> {
  expect(await requestClientCode(link, { purpose: 'sign_contract', target: contractId })).toMatchObject({ ok: true });
  const [mail] = outbox.sent;
  expect(mail.to).toBe('client@example.org');
  expect(mail.homeUrl).toContain(`/d/${link}`);
  expect(await signContractInHome(link, { contractId, name: 'Client Name', code: mail.code })).toMatchObject({ ok: true });
  const [contract] = await ownerQuery<{ status: string }>(`select status::text as status from public.contracts where id = $1`, [contractId]);
  expect(contract.status).toBe('signed');
}

describe('شقة الرحاب 2', () => {
  it('(a) forward: design first, then the contract on the link the client already holds', async () => {
    const pair = await rehab2();
    const id = await seedDelivery(orgId, pair, 'execution_decision');
    const link = (await mintDeliveryLinkCore(owner, id)).data!;
    const boq = await seedBoq(orgId, { project: pair, engagementId: id });
    const [{ token_hash: tokenHash }] = await projectRows(pair.projectId);
    const target = await targetOf(id);

    expect(await generate(boq.boqId)).toEqual({ ok: false, error: 'design_open', params: target });
    expect(await create(pair)).toEqual(ACTIVE);
    expect(await fire(id, 'chooseExecution')).toMatchObject({ ok: true });

    const contractId = await contractOnLink(boq.boqId, link);
    await signOnLink(link, contractId);

    const detail = await loadEngagementDetail(owner, id);
    expect(detail?.execution?.contract).toMatchObject({ id: contractId, status: 'signed' });
    expect(endingChoicesFrom(detail!.header.state)).toEqual([]);
    expect(await create(pair)).toEqual(TAKEN(target.delivery));
    expect(await projectRows(pair.projectId)).toEqual([expect.objectContaining({ id, token_hash: tokenHash })]);
  });

  it('(b) design only: closed, then continued, on the same row and the same link', async () => {
    const pair = await rehab2();
    const id = await seedDelivery(orgId, pair, 'execution_decision');
    const link = (await mintDeliveryLinkCore(owner, id)).data!;
    const boq = await seedBoq(orgId, { project: pair, engagementId: id });
    const [{ token_hash: tokenHash }] = await projectRows(pair.projectId);
    const target = await targetOf(id);

    expect(await fire(id, 'chooseDesignOnly')).toMatchObject({ ok: true });
    expect(await generate(boq.boqId)).toEqual({ ok: false, error: 'design_open', params: target });
    expect(await recordHandoffAndCloseCore(owner, { engagementId: id })).toMatchObject({ ok: true });
    expect((await projectRows(pair.projectId))[0].state).toBe('closed_design_only');

    expect(await generate(boq.boqId)).toEqual({ ok: false, error: 'design_only_closed', params: target });
    expect(await create(pair)).toEqual(TAKEN(target.delivery));
    expect(await fire(id, 'continueToExecution')).toMatchObject({ ok: true });

    const contractId = await contractOnLink(boq.boqId, link);
    await signOnLink(link, contractId);
    expect(await projectRows(pair.projectId)).toEqual([expect.objectContaining({ id, state: 'execution', token_hash: tokenHash })]);
  });

  it('(c) the measured state, seeded as production has it: abandoning the open row leaves the running one', async () => {
    const pair = await rehab2();
    const running = await seedDelivery(orgId, pair, 'execution');
    const link = (await mintDeliveryLinkCore(owner, running)).data!;
    const contract = await seedExecutionContract(orgId, { state: 'signed', delivery: { id: running, ...pair } });
    const open = await seedDelivery(orgId, pair, 'execution_decision');

    expect(await ensureClientHomeCore(owner, { contractId: contract.contractId })).toEqual({
      ok: false,
      error: 'design_open',
      params: await targetOf(open),
    });

    expect(await executeTransition(owner, { engagementId: open, trigger: 'abandon' })).toMatchObject({ ok: true });

    expect(await ensureClientHomeCore(owner, { contractId: contract.contractId })).toMatchObject({
      ok: true,
      data: { engagementId: running, link },
    });
    expect(await getEngagementByProject(owner, pair.projectId)).toMatchObject({ id: running });
    expect(await create(pair)).toEqual(TAKEN((await targetOf(running)).delivery));
    expect((await projectRows(pair.projectId)).map((row) => row.id)).toEqual([running, open]);
  });
});
