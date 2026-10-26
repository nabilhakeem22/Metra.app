import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readHomeView } from '@/app/[locale]/d/[token]/home-read';
import { ensureClientHomeCore } from '@/lib/client-home/ensure';
import { getHomeByToken } from '@/lib/client-home/read';
import { createEngagementCore } from '@/lib/engagements/core';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { countProjectDeliveries } from '@/lib/engagements/queries/by-project';
import { getExecutionFacts } from '@/lib/execution/queries/facts';
import { hashShareToken } from '@/lib/share/token';
import type { OrgContext } from '@/lib/db/context';
import { seedHome, setClientEmail } from './client-home-fixture';
import { closeExecutionFixture, ownerQuery, seedClientProject, seedExecutionContract, seedRequest, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// Client home H4.3 (AC26 to AC28 through the app): ensureClientHomeCore finds
// the home of a BOQ contract, creating ONE light delivery per (project, client)
// when no delivery stands behind the BOQ, and hands back its live link; the
// link opens the Execution tab on the contract. Light deliveries do not count
// toward the project's delivery cap (ruling D14). And the home reader against
// the real token SDF (H4.1).

const SECRET = 'h4-share-link-secret-0123456789abcdef0123456789';
const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let manager: OrgContext;
let previousSecret: string | undefined;

beforeAll(async () => {
  previousSecret = process.env.SHARE_LINK_SECRET;
  process.env.SHARE_LINK_SECRET = SECRET;
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }] });
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  manager = ctxFor(orgId, seeded.memberIds[0], 'project_manager');
  orgIds.push(orgId);
});

afterEach(() => {
  process.env.SHARE_LINK_SECRET = SECRET;
});

afterAll(async () => {
  if (previousSecret === undefined) delete process.env.SHARE_LINK_SECRET;
  else process.env.SHARE_LINK_SECRET = previousSecret;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

interface Delivery {
  id: string;
  number: number;
  state: string;
  entry_phase: string;
  client_id: string;
  project_id: string;
  title_en: string | null;
  token_hash: string | null;
}

const deliveriesOf = (projectId: string) =>
  ownerQuery<Delivery>(
    `select id, number, state::text as state, entry_phase, client_id, project_id, title_en, token_hash
       from public.design_engagements where project_id = $1 order by number`,
    [projectId],
  );

async function ensured(ctx: OrgContext, contractId: string) {
  const res = await ensureClientHomeCore(ctx, { contractId });
  if (!res.ok || !res.data) throw new Error(`ensureClientHomeCore: ${String(res.error)}`);
  return res.data;
}

describe('ensureClientHomeCore: the light delivery (AC26)', () => {
  it('creates exactly ONE light delivery for an issued BOQ contract with no delivery behind it', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    const home = await ensured(owner, contract.contractId);
    const rows = await deliveriesOf(contract.projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: home.engagementId,
      state: 'execution',
      entry_phase: 'execution',
      client_id: contract.clientId,
      title_en: 'Execution project',
    });
    expect(await ensured(owner, contract.contractId)).toMatchObject({ engagementId: home.engagementId });
    expect(await deliveriesOf(contract.projectId)).toHaveLength(1);
    const audits = await ownerQuery<{ action: string }>(
      `select action::text as action from public.audit_log where org_id = $1 and entity_id = $2`,
      [orgId, home.engagementId],
    );
    expect(audits.map((row) => row.action)).toEqual(['issue', 'issue']);
  });

  it('two concurrent calls create one', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'signed' });
    const [first, second] = await Promise.all([ensured(owner, contract.contractId), ensured(owner, contract.contractId)]);
    expect(first.engagementId).toBe(second.engagementId);
    expect(await deliveriesOf(contract.projectId)).toHaveLength(1);
    const audits = await ownerQuery<{ home: string }>(
      `select after ->> 'home' as home from public.audit_log where org_id = $1 and entity_id = $2 order by home`,
      [orgId, first.engagementId],
    );
    expect(audits.map((row) => row.home)).toEqual(['created', 'existing']);
  });

  it('a second client of the same project gets its own light delivery (one per project and client)', async () => {
    const first = await seedExecutionContract(orgId, { state: 'issued' });
    const [other] = await ownerQuery<{ id: string }>(`insert into public.clients (org_id, name_en) values ($1, 'Client B') returning id`, [orgId]);
    const second = await seedExecutionContract(orgId, { state: 'issued', project: { clientId: other.id, projectId: first.projectId } });
    const homes = [await ensured(owner, first.contractId), await ensured(owner, second.contractId)];
    expect(homes[0].engagementId).not.toBe(homes[1].engagementId);
    const rows = await deliveriesOf(first.projectId);
    expect(rows.map((row) => row.client_id).sort()).toEqual([first.clientId, other.id].sort());
  });

  it('the home of a BOQ generated for a delivery is that delivery: nothing is created', async () => {
    const home = await seedHome(orgId, 'issued');
    const ensuredHome = await ensured(owner, home.contract.contractId);
    expect(ensuredHome.engagementId).toBe(home.delivery.id);
    expect(await deliveriesOf(home.delivery.projectId)).toHaveLength(1);
    // Its existing link is re-derivable only with a nonce: a fixture token has none.
    expect(ensuredHome).toMatchObject({ link: null, linkReason: 'delivery_link_unrecoverable' });
  });

  it('refuses what has no home: a draft, an unknown or foreign contract, and an older contract the home no longer shows', async () => {
    const draft = await seedExecutionContract(orgId, { state: 'draft' });
    expect(await ensureClientHomeCore(owner, { contractId: draft.contractId })).toMatchObject({ ok: false, error: 'contract_not_issued' });
    expect(await ensureClientHomeCore(owner, { contractId: 'not-a-uuid' })).toMatchObject({ ok: false, error: 'record_not_found' });
    const theirs = await seedOrg({ owners: 1 });
    orgIds.push(theirs.orgId);
    const foreign = await seedExecutionContract(theirs.orgId, { state: 'issued' });
    expect(await ensureClientHomeCore(owner, { contractId: foreign.contractId })).toMatchObject({ ok: false, error: 'record_not_found' });
    expect(await deliveriesOf(foreign.projectId)).toHaveLength(0);

    const older = await seedExecutionContract(orgId, { state: 'issued' });
    await seedExecutionContract(orgId, { state: 'issued', project: { clientId: older.clientId, projectId: older.projectId } });
    expect(await ensureClientHomeCore(owner, { contractId: older.contractId })).toMatchObject({ ok: false, error: 'client_home_unavailable' });
    expect(await deliveriesOf(older.projectId)).toHaveLength(0);
  });

  it('a project manager may not issue contracts, so is refused before anything is read', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    expect(await ensureClientHomeCore(manager, { contractId: contract.contractId })).toEqual({ ok: false, error: 'forbidden' });
    expect(await deliveriesOf(contract.projectId)).toHaveLength(0);
  });
});

describe('ensureClientHomeCore: the link (AC27)', () => {
  it('mints the first link once, re-derives the same one after, and it opens the Execution tab on the contract to sign', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    await setClientEmail(orgId, contract.clientId, 'client@example.com');
    const first = await ensured(owner, contract.contractId);
    expect(first.link).toEqual(expect.any(String));
    const [row] = await deliveriesOf(contract.projectId);
    expect(row.token_hash).toBe(hashShareToken(first.link as string));
    expect((await ensured(owner, contract.contractId)).link).toBe(first.link);

    const view = await readHomeView(first.link as string, 'execution');
    expect(view.tab).toBe('execution');
    if (view.tab !== 'execution') throw new Error('not the Execution tab');
    expect(view.home.delivery).toMatchObject({ entryPhase: 'execution', phase: 'execution' });
    expect(view.home.execution.location).toMatchObject({ reason: 'sign_contract', step: 'signature', whoseMove: 'client' });
    expect(view.home.execution.contract).toMatchObject({ id: contract.contractId, status: 'issued', signingOpen: true });
    expect(view.home.codeChannel).toEqual({ hint: 'c•••@e•••.com' });
  });

  it('without the link secret: an existing link cannot be shown, and the core says so instead of replacing it', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    await ensured(owner, contract.contractId);
    delete process.env.SHARE_LINK_SECRET;
    expect(await ensured(owner, contract.contractId)).toMatchObject({ link: null, linkReason: 'delivery_links_not_configured' });
  });
});

describe('the light delivery in the studio (AC28, ruling D14)', () => {
  it('stands on the contract it was made for, and is not counted toward the project delivery cap', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    const home = await ensured(owner, contract.contractId);
    expect((await getExecutionFacts(owner, home.engagementId)).contract).toMatchObject({ id: contract.contractId, status: 'issued' });
    expect(await countProjectDeliveries(owner, contract.projectId)).toBe(0);
    for (let index = 0; index < 2; index += 1) {
      const created = await createEngagementCore(owner, { clientId: contract.clientId, projectId: contract.projectId, titleEn: `Design ${String(index)}` });
      expect(created.ok).toBe(true);
      await tamper(`update public.design_engagements set state = 'closed_design_only' where id = $1`, [(created as { data?: string }).data]);
    }
    expect(await countProjectDeliveries(owner, contract.projectId)).toBe(2);
    expect(await createEngagementCore(owner, { clientId: contract.clientId, projectId: contract.projectId, titleEn: 'Third' })).toMatchObject({
      ok: false,
      error: 'check_fields',
      fields: { projectId: { code: 'project_delivery_limit_reached' } },
    });
  });
});

describe('getHomeByToken against the real token SDF (H4.1)', () => {
  it('a signed contract with a request due places the client on pay_request, with the money card', async () => {
    const home = await seedHome(orgId, 'signed');
    await seedRequest(orgId, home.contract.contractId, owner.userId, { milestoneId: home.contract.milestoneIds[0] }, '62000');
    const read = await getHomeByToken(home.delivery.rawToken);
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') throw new Error('no home');
    expect(read.home.execution?.location.reason).toBe('pay_request');
    expect(read.home.execution?.money?.requests[0]).toMatchObject({ outstanding: '62000.0000', claimedAt: null });
    expect(JSON.stringify(read.home)).not.toMatch(/flow_source|supervision|issued_boq/i);
  });

  it('a revoked link and a blank token are not_found', async () => {
    const home = await seedHome(orgId, 'issued');
    await ownerQuery(`update public.design_engagements set token_hash = null, token_nonce = null where id = $1`, [home.delivery.id]);
    expect(await getHomeByToken(home.delivery.rawToken)).toEqual({ status: 'not_found' });
    expect(await getHomeByToken('  ')).toEqual({ status: 'not_found' });
  });

  it('a delivery still in design has no execution block, so its Execution tab opens the design tab', async () => {
    const { clientId, projectId } = await seedClientProject(orgId);
    const created = await createEngagementCore(owner, { clientId, projectId, titleEn: 'Designing' });
    const minted = await mintDeliveryLinkCore(owner, (created as { data?: string }).data as string);
    const raw = minted.data;
    const read = await getHomeByToken(raw as string);
    expect(read.status === 'ok' && read.home.execution).toBeNull();
    expect((await readHomeView(raw as string, 'execution')).tab).toBe('design');
  });
});
