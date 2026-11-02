import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadBoqTab } from '@/app/[locale]/(app)/projects/[id]/boq-tab-data';
import { MAX_BOQ_LINES, startBoqVersionCore } from '@/lib/boqs/core';
import { deleteBoqLineCore, setBoqDiscountCore, updateBoqLineCore } from '@/lib/boqs/edit';
import { getBoqTabDocument, getProjectBoqSummary } from '@/lib/boqs/queries';
import type { OrgContext } from '@/lib/db/context';
import { boqContent, boqRow, draftsOf, firstLineOf } from './boq-new-version-fixture';
import { seedBoq, seedDelivery } from './contract-from-boq-fixture';
import { targetOf } from './design-first-fixture';
import { closeExecutionFixture, ownerQuery, seedClientProject, seedExecutionContract, type ContractState } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// startBoqVersionCore: who may, when, and what the draft holds.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;
let manager: OrgContext;
let others: OrgContext[];
let otherOrgOwner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }, { role: 'site_engineer' }, { role: 'accountant' }, { role: 'viewer' }] });
  const other = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId, other.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  const [pm, engineer, accountant, viewer] = seeded.memberIds;
  manager = ctxFor(orgId, pm, 'project_manager');
  others = [ctxFor(orgId, engineer, 'site_engineer'), ctxFor(orgId, accountant, 'accountant'), ctxFor(orgId, viewer, 'viewer')];
  otherOrgOwner = ctxFor(other.orgId, other.ownerIds[0], 'owner');
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** An issued BOQ on the home of a fresh pair. */
async function issuedAtHome(linesPerSection: number[] = [3, 2]) {
  const pair = await seedClientProject(orgId);
  const home = await seedDelivery(orgId, pair, 'execution');
  const { boqId } = await seedBoq(orgId, { project: pair, engagementId: home, linesPerSection });
  return { pair, home, x: boqId };
}

describe('refusals', () => {
  it.each<ContractState>(['draft', 'issued', 'signed'])('a %s contract on it: boq_has_contract, no draft', async (state) => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'execution');
    const contract = await seedExecutionContract(orgId, { state, delivery: { id, ...pair } });
    expect(await startBoqVersionCore(owner, contract.boqId)).toEqual({ ok: false, error: 'boq_has_contract' });
    expect(await draftsOf(pair.projectId)).toEqual([]);
  });

  it.each(['boq', 'execution_decision', 'design_only_handoff'])('design open at %s: design_open, naming it', async (state) => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, state);
    const { boqId } = await seedBoq(orgId, { project: pair, engagementId: id });
    expect(await startBoqVersionCore(owner, boqId)).toEqual({ ok: false, error: 'design_open', params: await targetOf(id) });
    expect(await draftsOf(pair.projectId)).toEqual([]);
  });

  it('closed as design only: design_only_closed, naming it', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'closed_design_only');
    const { boqId } = await seedBoq(orgId, { project: pair, engagementId: id });
    expect(await startBoqVersionCore(owner, boqId)).toEqual({ ok: false, error: 'design_only_closed', params: await targetOf(id) });
  });

  it('no delivery: boq_delivery_abandoned behind an abandoned one, boq_needs_delivery behind none', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'abandoned');
    const onAbandoned = await seedBoq(orgId, { project: pair, engagementId: id });
    expect(await startBoqVersionCore(owner, onAbandoned.boqId)).toEqual({ ok: false, error: 'boq_delivery_abandoned' });
    const standalone = await seedBoq(orgId, { deliveryState: null });
    expect(await startBoqVersionCore(owner, standalone.boqId)).toEqual({ ok: false, error: 'boq_needs_delivery' });
  });

  it("another org's BOQ stays boq_not_found", async () => {
    const { x, pair } = await issuedAtHome();
    expect(await startBoqVersionCore(otherOrgOwner, x)).toEqual({ ok: false, error: 'boq_not_found' });
    expect(await draftsOf(pair.projectId)).toEqual([]);
  });

  it('a BOQ that is not issued: boq_not_issued; a non-id: malformed', async () => {
    for (const state of ['draft', 'superseded'] as const) {
      const { boqId } = await seedBoq(orgId, { state });
      expect(await startBoqVersionCore(owner, boqId)).toEqual({ ok: false, error: 'boq_not_issued' });
    }
    expect(await startBoqVersionCore(owner, 'nope')).toEqual({ ok: false, error: 'malformed' });
  });

  it('roles without boq_build create: forbidden; a project manager may', async () => {
    const { x, pair } = await issuedAtHome();
    for (const ctx of others) expect(await startBoqVersionCore(ctx, x), ctx.role).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await draftsOf(pair.projectId)).toEqual([]);
    expect(await startBoqVersionCore(manager, x)).toMatchObject({ ok: true });
  });
});

describe('one draft', () => {
  it('a draft already there is the answer, and no second one is made', async () => {
    const { x, pair } = await issuedAtHome();
    const first = await startBoqVersionCore(owner, x);
    expect(await startBoqVersionCore(owner, x)).toEqual({ ok: true, data: first.data });
    expect(await draftsOf(pair.projectId)).toEqual([first.data]);
  });

  it('a draft from another path is the answer too', async () => {
    const { x, pair } = await issuedAtHome();
    const other = await seedBoq(orgId, { project: pair, state: 'draft', deliveryState: null });
    expect(await startBoqVersionCore(owner, x)).toEqual({ ok: true, data: other.boqId });
    expect(await draftsOf(pair.projectId)).toEqual([other.boqId]);
  });

  it('two concurrent calls make one draft, 10 rounds', async () => {
    for (let round = 0; round < 10; round += 1) {
      const { x, pair } = await issuedAtHome();
      const [a, b] = await Promise.all([startBoqVersionCore(owner, x), startBoqVersionCore(manager, x)]);
      expect(a, `round ${String(round)}`).toMatchObject({ ok: true });
      expect(b.data).toBe(a.data);
      expect(await draftsOf(pair.projectId)).toEqual([a.data]);
    }
  });
});

describe('what the draft holds', () => {
  it('the same sections, order and money as X, on the same client and the home', async () => {
    const pair = await seedClientProject(orgId);
    const home = await seedDelivery(orgId, pair, 'execution');
    const { boqId: x } = await seedBoq(orgId, { project: pair, engagementId: home, linesPerSection: [8, 3, 5], state: 'draft' });
    expect(await setBoqDiscountCore(owner, { boqId: x, discountPct: '7.5' })).toMatchObject({ ok: true });
    await ownerQuery(`update public.boqs set status = 'issued', notes_en = 'Keep this note' where id = $1`, [x]);
    const y = (await startBoqVersionCore(owner, x)).data!;
    const [copied, source] = [await boqContent(y), await boqContent(x)];
    expect(copied).toEqual(source);
    expect(source.lines).toHaveLength(16);
    expect(source.header.discount_amount).not.toBe('0.0000');
    expect(await boqRow(y)).toMatchObject({ status: 'draft', engagement_id: home, client_id: pair.clientId, supersedes_id: null });
    const [{ shared }] = await ownerQuery<{ shared: number }>(
      `select count(*)::int as shared from public.boq_lines a join public.boq_lines b on a.id = b.id where a.boq_id = $1 and b.boq_id = $2`,
      [x, y],
    );
    expect(shared).toBe(0);
  });

  it('the draft edits without touching X', async () => {
    const { x } = await issuedAtHome();
    const before = await boqContent(x);
    const y = (await startBoqVersionCore(owner, x)).data!;
    const line = await firstLineOf(y);
    expect(await updateBoqLineCore(owner, { lineId: line, patch: { unitPrice: '777', qty: '3' } })).toMatchObject({ ok: true });
    expect(await deleteBoqLineCore(owner, { lineId: await firstLineOf(y) })).toMatchObject({ ok: true });
    expect(await setBoqDiscountCore(owner, { boqId: y, discountPct: '5' })).toMatchObject({ ok: true });
    expect(await boqContent(x)).toEqual(before);
    expect(await boqRow(x)).toMatchObject({ status: 'issued' });
    expect((await boqContent(y)).header.total).not.toBe(before.header.total);
  });

  it('costs and margin follow the same visibility as any draft', async () => {
    const { x, pair } = await issuedAtHome();
    const y = (await startBoqVersionCore(owner, x)).data!;
    const hidden = (await getBoqTabDocument(owner, pair.projectId, { showCost: false, canBuild: true })).boq!;
    expect(hidden.id).toBe(y);
    expect(hidden).not.toHaveProperty('totalCost');
    expect(hidden.sections[0].lines[0]).not.toHaveProperty('unitCost');
    expect(JSON.stringify(hidden)).not.toContain('lineMargin');
    const shown = (await getBoqTabDocument(owner, pair.projectId, { showCost: true, canBuild: true })).boq!;
    expect(shown.totalCost).toBe((await boqContent(x)).header.total_cost);
    expect(shown.sections[0].lines[0].unitCost).toBe('60.0000');
  });

  it('MAX_BOQ_LINES holds: one over is too_many_lines, no draft; exactly at it copies them all', async () => {
    const over = await issuedAtHome([MAX_BOQ_LINES + 1]);
    expect(await startBoqVersionCore(owner, over.x)).toEqual({ ok: false, error: 'too_many_lines' });
    expect(await draftsOf(over.pair.projectId)).toEqual([]);
    const at = await issuedAtHome([MAX_BOQ_LINES]);
    const y = (await startBoqVersionCore(owner, at.x)).data!;
    const [{ lines }] = await ownerQuery<{ lines: number }>(`select count(*)::int as lines from public.boq_lines where boq_id = $1`, [y]);
    expect(lines).toBe(MAX_BOQ_LINES);
  });
});

describe('the tab over a version', () => {
  it('a builder sees the draft in place of X; other readers and the cockpit summary stay on X', async () => {
    const { x, pair } = await issuedAtHome();
    const y = (await startBoqVersionCore(owner, x)).data!;
    for (const ctx of [owner, manager]) {
      const tab = await loadBoqTab(ctx, pair.projectId);
      expect(tab.boq?.id, ctx.role).toBe(y);
      expect(tab.boq?.status).toBe('draft');
      expect(tab.execution.canStartVersion).toBe(false);
      expect(tab.issueNeedsDelivery).toBe(false);
      expect(tab.issueBlockedByContract).toBe(false);
    }
    expect((await loadBoqTab(others[2], pair.projectId)).boq?.id).toBe(x);
    expect((await getProjectBoqSummary(owner, pair.projectId))?.id).toBe(x);
  });

  it('a contract generated on X meanwhile puts X back in front, and New version off', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'execution');
    const contract = await seedExecutionContract(orgId, { state: 'draft', delivery: { id, ...pair } });
    const draft = await seedBoq(orgId, { project: pair, state: 'draft', deliveryState: null });
    const tab = await loadBoqTab(owner, pair.projectId);
    expect(tab.boq?.id).toBe(contract.boqId);
    expect(tab.boq?.id).not.toBe(draft.boqId);
    expect(tab.execution).toEqual({ contractId: contract.contractId, canGenerate: true, refusal: null, canStartVersion: false });
  });

  it('a project manager, no generate read: New version with no contract id', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'execution');
    const contract = await seedExecutionContract(orgId, { state: 'issued', delivery: { id, ...pair } });
    await ownerQuery(`update public.contracts set status = 'terminated' where id = $1`, [contract.contractId]);
    expect((await loadBoqTab(manager, pair.projectId)).execution).toEqual({ contractId: null, canGenerate: false, refusal: null, canStartVersion: true });
  });

  it('at design: no New version, the refusal stands', async () => {
    const pair = await seedClientProject(orgId);
    const id = await seedDelivery(orgId, pair, 'execution_decision');
    await seedBoq(orgId, { project: pair, engagementId: id });
    expect((await loadBoqTab(owner, pair.projectId)).execution).toMatchObject({ canStartVersion: false, refusal: { code: 'design_open' } });
  });
});
