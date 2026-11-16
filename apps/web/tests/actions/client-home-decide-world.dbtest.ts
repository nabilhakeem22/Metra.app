import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H7.1 end to end, AC24 to AC26: what a decision comes to when the world changes
// after the code is sent, under a held row, and the lazy lines, through the REAL
// server actions and the real database, with a FAKE sender. No code or raw link
// appears in the log or in any token function's bound values (AC27).

const outbox = vi.hoisted(() => ({ sent: [] as Array<{ to: string; code: string; documentNumber: string; homeUrl: string }> }));
vi.mock('@/lib/email/client-code', () => ({
  sendClientCodeEmail: async (input: { to: string; code: string; documentNumber: string; homeUrl: string }) => {
    outbox.sent.push(input);
    return { sent: true };
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest-client', 'cf-connecting-ip': '10.1.2.3' }) }));
const sdfCalls = vi.hoisted(() => ({ queries: [] as unknown[] }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/share/sdf-call')>();
  return {
    ...original,
    readSdfJson: (query: unknown, options?: unknown) => {
      sdfCalls.queries.push(query);
      return original.readSdfJson(query as never, options as never);
    },
  };
});
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.invalid';
});

import { requestClientCode } from '@/app/[locale]/d/[token]/code-actions';
import { loadChangeOrderLines } from '@/app/[locale]/d/[token]/variation-actions';
import { terminateContractCore } from '@/lib/contracts/lifecycle/terminate';
import type { OrgContext } from '@/lib/db/context';
import { getHomeByToken } from '@/lib/client-home/read';
import { recordVariationDecisionOnPaperCore } from '@/lib/variations/core';
import { askForCode, decide, homeWithOrder, orderState } from './client-home-decide-fixture';
import { codesOf, holdLock } from './client-home-fixture';
import { closeExecutionFixture, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
const raws: string[] = [];
let orgId: string;
let owner: OrgContext;
let printed: string;

beforeAll(() => {
  for (const method of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      printed += JSON.stringify(args);
    });
  }
});

beforeEach(async () => {
  printed = '';
  outbox.sent.length = 0;
  sdfCalls.queries.length = 0;
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }, { role: 'project_manager' }, { role: 'accountant' }] });
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  orgIds.push(orgId);
});

afterEach(async () => {
  await tamper(`delete from public.client_verification_codes where org_id = $1`, [orgId]);
  // AC27: no code a test was sent appears in what it printed or in any token function's bound values; no raw link in the log.
  const bound = JSON.stringify(sdfCalls.queries);
  for (const { code } of outbox.sent) {
    expect(printed).not.toContain(code);
    expect(bound).not.toContain(`"${code}"`);
  }
  for (const raw of raws) expect(printed).not.toContain(raw);
});

afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_APP_URL;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

describe('the world changes after the code is sent (AC24)', () => {
  it("the order's link lapses: link_expired, the code unused; the home says lapsed 1, open 0; no code can be asked now", async () => {
    const { home, order } = await homeWithOrder(orgId, raws);
    const { code } = await askForCode(outbox.sent, home, order.id);
    await tamper(`update public.variation_orders set share_expires_at = now() - interval '1 second' where id = $1`, [order.id]);
    expect(await decide(home, order.id, code)).toEqual({ ok: false, error: 'link_expired' });
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ consumed_at: null, result_ref: null });
    const read = await getHomeByToken(home.delivery.rawToken);
    expect(read.status === 'ok' && read.home.execution).toMatchObject({ openVariationCount: 0, lapsedVariationCount: 1 });
    await tamper(`delete from public.client_verification_codes where org_id = $1`, [orgId]);
    expect(await requestClientCode(home.delivery.rawToken, { purpose: 'decide_variation', target: order.id })).toEqual({ ok: false, error: 'not_available' });
  });

  it('the contract is terminated: contract_inactive, the code unused', async () => {
    const { home, order } = await homeWithOrder(orgId, raws);
    const { code } = await askForCode(outbox.sent, home, order.id);
    expect((await terminateContractCore(owner, { id: home.contract.contractId })).ok).toBe(true);
    expect(await decide(home, order.id, code)).toEqual({ ok: false, error: 'contract_inactive' });
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ consumed_at: null, result_ref: null, attempts: 0 });
  });

  it('the studio records a paper decision: already, the code unused, one decision', async () => {
    const { home, order } = await homeWithOrder(orgId, raws);
    const { code } = await askForCode(outbox.sent, home, order.id);
    const paper = await recordVariationDecisionOnPaperCore(owner, { variationOrderId: order.id, decision: 'reject', decidedOn: new Date().toISOString().slice(0, 10) });
    expect(paper.ok).toBe(true);
    expect(await decide(home, order.id, code)).toEqual({ ok: true, already: true });
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ consumed_at: null, result_ref: null });
    expect((await orderState(order.id)).status).toBe('rejected');
    expect((await orderState(order.id)).events).toHaveLength(1);
  });
});

describe('a held row (AC25)', () => {
  it.each([
    ['the order', 'variation_orders', (ids: { order: string; contract: string }) => ids.order],
    ['the contract', 'contracts', (ids: { order: string; contract: string }) => ids.contract],
  ])('%s held FOR UPDATE past 4 s: busy, the code unused, no 55P03 escapes; it decides after the release', async (_name, table, idOf) => {
    const { home, order } = await homeWithOrder(orgId, raws);
    const { code } = await askForCode(outbox.sent, home, order.id);
    const hold = await holdLock(`select 1 from public.${table} where id = $1 for update`, [idOf({ order: order.id, contract: home.contract.contractId })], 7000);
    const held = await decide(home, order.id, code);
    await hold.release();
    expect(held).toEqual({ ok: false, error: 'busy' });
    expect(printed).not.toContain('55P03');
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ attempts: 0, consumed_at: null });
    expect(await decide(home, order.id, code)).toEqual({ ok: true, already: false });
  }, 20_000);
});

describe('the lazy lines (AC26)', () => {
  it("the order's lines, sorted, as contract lines; gone after the decision, and for another delivery's order", async () => {
    const { home, order } = await homeWithOrder(orgId, raws);
    const answer = await loadChangeOrderLines(home.delivery.rawToken, order.id);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.lines.map((line) => line.description_en)).toEqual(['SEEDED LINE 3', 'SEEDED LINE 2', 'SEEDED LINE 1']);
    expect(answer.lines[0]).toMatchObject({ item_code: null, provisional: false });
    for (const line of answer.lines) expect(line).not.toHaveProperty('unit_cost');
    const foreign = await homeWithOrder(orgId, raws);
    expect(await loadChangeOrderLines(home.delivery.rawToken, foreign.order.id)).toEqual({ ok: false, error: 'gone' });
    const { code } = await askForCode(outbox.sent, home, order.id);
    expect((await decide(home, order.id, code)).ok).toBe(true);
    expect(await loadChangeOrderLines(home.delivery.rawToken, order.id)).toEqual({ ok: false, error: 'gone' });
  });
});
