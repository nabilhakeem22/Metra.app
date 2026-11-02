import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H7.1 end to end, AC20 to AC27: the client decides a change order in the home
// through the REAL server actions (requestClientCode, decideVariationInHome,
// loadChangeOrderLines) and the real database, with a FAKE sender in place of the
// email: Resend is never reached from a test. The fake keeps what it was handed,
// so a test can type the code the client would have read. Every token function is
// counted at lib/share/sdf-call (the real one, spied), so "no round trip" is
// measured, and its bound values are kept, so the raw code is shown never to leave
// the server.

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
import { decideVariationInHome, loadChangeOrderLines } from '@/app/[locale]/d/[token]/variation-actions';
import { terminateContractCore } from '@/lib/contracts/lifecycle/terminate';
import type { OrgContext } from '@/lib/db/context';
import { getHomeByToken } from '@/lib/client-home/read';
import { mintShareToken } from '@/lib/share/token';
import { recordVariationDecisionOnPaperCore } from '@/lib/variations/core';
import { codesOf, holdLock, seedHome, seedLightHome, type Home } from './client-home-fixture';
import { closeExecutionFixture, ownerQuery, seedVariation, tamper } from './execution-fixture';
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

const NAME = ' ‮هشام   عادل\u0000 ';
const DECIDED_AS = 'هشام عادل';

async function homeWithOrder(home?: Home) {
  const seeded = home ?? (await seedHome(orgId, 'signed'));
  raws.push(seeded.delivery.rawToken);
  const link = mintShareToken();
  raws.push(link.raw);
  const order = await seedVariation(orgId, seeded.contract, 'issued', { tokenHash: link.hash, timeExtensionDays: 7 });
  await tamper(
    `insert into public.variation_order_lines (org_id, variation_order_id, description_en, qty, unit, unit_price, line_total, sort_order)
     select $1, $2, 'SEEDED LINE ' || n, 1, 'sqm', 10, 10, 4 - n from generate_series(1, 3) n`,
    [orgId, order.id],
  );
  return { home: seeded, order, link };
}

async function askForCode(home: Home, orderId: string) {
  const answer = await requestClientCode(home.delivery.rawToken, { purpose: 'decide_variation', target: orderId });
  if (!answer.ok) throw new Error(`no code: ${answer.error}`);
  return { code: outbox.sent[outbox.sent.length - 1].code, answer };
}

const decide = (home: Home, variationId: string, code: string, decision: 'approve' | 'reject' = 'approve', name: unknown = NAME) =>
  decideVariationInHome(home.delivery.rawToken, { variationId, decision, name: name as string, code });

const wrongOf = (code: string) => (code === '000000' ? '111111' : '000000');

async function orderState(orderId: string) {
  const [row] = await ownerQuery<{ status: string; events: Array<{ id: string; kind: string; actor_channel: string; actor_name: string; ip: string; user_agent: string }> | null }>(
    `select v.status::text,
            (select json_agg(json_build_object('id', e.id, 'kind', e.kind, 'actor_channel', e.actor_channel, 'actor_name', e.actor_name, 'ip', e.ip, 'user_agent', e.user_agent))
               from public.variation_order_events e where e.variation_order_id = v.id and e.kind in ('approved', 'rejected')) as events
       from public.variation_orders v where v.id = $1`,
    [orderId],
  );
  return { status: row.status, events: row.events ?? [] };
}

const notified = async (contractId: string, body: string) =>
  (await ownerQuery<{ n: number }>(`select count(*)::int as n from public.notifications where entity_id = $1 and body_key = $2`, [contractId, body]))[0].n;

async function expectDecidedOnce(home: Home, orderId: string, decision: 'approve' | 'reject') {
  const kind = decision === 'approve' ? 'approved' : 'rejected';
  const { code } = await askForCode(home, orderId);
  expect(await decide(home, orderId, code, decision)).toEqual({ ok: true, already: false });
  const state = await orderState(orderId);
  expect(state.status).toBe(kind);
  expect(state.events).toEqual([{ id: expect.any(String), kind, actor_channel: 'client', actor_name: DECIDED_AS, ip: '10.1.2.3', user_agent: 'vitest-client' }]);
  const [stored] = await codesOf(home.delivery.id);
  expect(stored.consumed_at).not.toBeNull();
  expect(stored.result_ref).toBe(state.events[0].id);
  expect(await notified(home.contract.contractId, `client_variation_${kind}`)).toBe(3);
  expect(await decide(home, orderId, code, decision)).toEqual({ ok: false, error: 'code_used' });
  expect((await orderState(orderId)).events).toHaveLength(1);
}

describe('the decision code (AC20, AC25)', () => {
  it('AC20: answers ok with the hint only; the email names VO-YYYY-NNNN and links the decision on the Execution tab', async () => {
    const { home, order } = await homeWithOrder();
    const { answer } = await askForCode(home, order.id);
    expect(answer).toEqual({ ok: true, hint: 'c•••@e•••.com', resendAfterSeconds: 60 });
    expect(outbox.sent).toEqual([
      expect.objectContaining({
        to: 'client.name@example.com',
        documentNumber: `VO-${new Date().getFullYear()}-${String(order.number).padStart(4, '0')}`,
        homeUrl: `https://example.invalid/ar-EG/d/${home.delivery.rawToken}?tab=execution&focus=variation:${order.id}`,
      }),
    ]);
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ purpose: 'decide_variation', target_key: order.id, attempts: 0 });
  });

  it('AC25: no email on file answers no_channel, writes no row and sends nothing', async () => {
    const { home, order } = await homeWithOrder(await seedHome(orgId, 'signed', null));
    expect(await requestClientCode(home.delivery.rawToken, { purpose: 'decide_variation', target: order.id })).toEqual({ ok: false, error: 'no_channel' });
    expect(outbox.sent).toEqual([]);
    expect(await codesOf(home.delivery.id)).toEqual([]);
  });
});

describe('deciding (AC21 to AC23)', () => {
  it.each(['approve', 'reject'] as const)('AC21: the right code with a name, %s: one event, the code used up by it, the studio told; a replay is code_used', async (decision) => {
    const { home, order } = await homeWithOrder();
    await expectDecidedOnce(home, order.id, decision);
  });

  it('AC25: a light delivery decides the same way', async () => {
    const { home, order } = await homeWithOrder(await seedLightHome(orgId, 'signed'));
    await expectDecidedOnce(home, order.id, 'approve');
  });

  it('AC22: no name, a decision of maybe, a non-uuid id: refused before the database, no try spent, no event', async () => {
    const { home, order } = await homeWithOrder();
    const { code } = await askForCode(home, order.id);
    sdfCalls.queries.length = 0;
    expect(await decide(home, order.id, code, 'approve', '   ')).toEqual({ ok: false, error: 'name_required' });
    expect(await decide(home, order.id, code, 'maybe' as never)).toEqual({ ok: false, error: 'wrong_target' });
    expect(await decide(home, 'nope', code)).toEqual({ ok: false, error: 'wrong_target' });
    expect(sdfCalls.queries).toHaveLength(0);
    expect((await codesOf(home.delivery.id))[0].attempts).toBe(0);
    expect(await orderState(order.id)).toEqual({ status: 'issued', events: [] });
    expect(outbox.sent).toHaveLength(1);
  });

  it('AC23: five wrong codes give 4, 3, 2, 1, 0 tries left; then the right code is code_locked, and the order stays issued', async () => {
    const { home, order } = await homeWithOrder();
    const { code } = await askForCode(home, order.id);
    for (const attemptsLeft of [4, 3, 2, 1, 0]) {
      expect(await decide(home, order.id, wrongOf(code))).toEqual({ ok: false, error: 'code_wrong', attemptsLeft });
    }
    expect(await decide(home, order.id, code)).toEqual({ ok: false, error: 'code_locked' });
    expect(await orderState(order.id)).toEqual({ status: 'issued', events: [] });
  });

  it("AC23: a signing code, or another order's, is code_unknown; another home's order is wrong_target, no try spent", async () => {
    const first = await homeWithOrder();
    const second = await homeWithOrder(first.home);
    const { code } = await askForCode(first.home, first.order.id);
    expect(await decide(first.home, second.order.id, code)).toEqual({ ok: false, error: 'code_unknown' });
    const signing = await seedHome(orgId, 'issued');
    const signed = await homeWithOrder(signing);
    const asked = await requestClientCode(signing.delivery.rawToken, { purpose: 'sign_contract', target: signing.contract.contractId });
    expect(asked.ok).toBe(true);
    expect(await decide(signing, signed.order.id, outbox.sent[outbox.sent.length - 1].code)).toEqual({ ok: false, error: 'code_unknown' });
    const foreign = await homeWithOrder();
    expect(await decide(first.home, foreign.order.id, code)).toEqual({ ok: false, error: 'wrong_target' });
    expect((await codesOf(first.home.delivery.id))[0].attempts).toBe(0);
  });
});

describe('the world changes after the code is sent (AC24)', () => {
  it("the order's link lapses: link_expired, the code unused; the home says lapsed 1, open 0; no code can be asked now", async () => {
    const { home, order } = await homeWithOrder();
    const { code } = await askForCode(home, order.id);
    await tamper(`update public.variation_orders set share_expires_at = now() - interval '1 second' where id = $1`, [order.id]);
    expect(await decide(home, order.id, code)).toEqual({ ok: false, error: 'link_expired' });
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ consumed_at: null, result_ref: null });
    const read = await getHomeByToken(home.delivery.rawToken);
    expect(read.status === 'ok' && read.home.execution).toMatchObject({ openVariationCount: 0, lapsedVariationCount: 1 });
    await tamper(`delete from public.client_verification_codes where org_id = $1`, [orgId]);
    expect(await requestClientCode(home.delivery.rawToken, { purpose: 'decide_variation', target: order.id })).toEqual({ ok: false, error: 'not_available' });
  });

  it('the contract is terminated: contract_inactive, the code unused', async () => {
    const { home, order } = await homeWithOrder();
    const { code } = await askForCode(home, order.id);
    expect((await terminateContractCore(owner, { id: home.contract.contractId })).ok).toBe(true);
    expect(await decide(home, order.id, code)).toEqual({ ok: false, error: 'contract_inactive' });
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ consumed_at: null, result_ref: null, attempts: 0 });
  });

  it('the studio records a paper decision: already, the code unused, one decision', async () => {
    const { home, order } = await homeWithOrder();
    const { code } = await askForCode(home, order.id);
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
    const { home, order } = await homeWithOrder();
    const { code } = await askForCode(home, order.id);
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
    const { home, order } = await homeWithOrder();
    const answer = await loadChangeOrderLines(home.delivery.rawToken, order.id);
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    expect(answer.lines.map((line) => line.description_en)).toEqual(['SEEDED LINE 3', 'SEEDED LINE 2', 'SEEDED LINE 1']);
    expect(answer.lines[0]).toMatchObject({ item_code: null, provisional: false });
    for (const line of answer.lines) expect(line).not.toHaveProperty('unit_cost');
    const foreign = await homeWithOrder();
    expect(await loadChangeOrderLines(home.delivery.rawToken, foreign.order.id)).toEqual({ ok: false, error: 'gone' });
    const { code } = await askForCode(home, order.id);
    expect((await decide(home, order.id, code)).ok).toBe(true);
    expect(await loadChangeOrderLines(home.delivery.rawToken, order.id)).toEqual({ ok: false, error: 'gone' });
  });
});
