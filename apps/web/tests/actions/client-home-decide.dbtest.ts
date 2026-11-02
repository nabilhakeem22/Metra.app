import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H7.1 end to end, AC20 to AC23 and AC27 (the world changing under a decision, a
// held row, the lazy lines: client-home-decide-world.dbtest.ts): the client decides a change order in the home
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
import { askForCode, DECIDED_AS, decide, homeWithOrder, orderState } from './client-home-decide-fixture';
import { codesOf, seedHome, seedLightHome, type Home } from './client-home-fixture';
import { closeExecutionFixture, ownerQuery, tamper } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
const raws: string[] = [];
let orgId: string;
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

const wrongOf = (code: string) => (code === '000000' ? '111111' : '000000');

const notified = async (contractId: string, body: string) =>
  (await ownerQuery<{ n: number }>(`select count(*)::int as n from public.notifications where entity_id = $1 and body_key = $2`, [contractId, body]))[0].n;

async function expectDecidedOnce(home: Home, orderId: string, decision: 'approve' | 'reject') {
  const kind = decision === 'approve' ? 'approved' : 'rejected';
  const { code } = await askForCode(outbox.sent, home, orderId);
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
    const { home, order } = await homeWithOrder(orgId, raws);
    const { answer } = await askForCode(outbox.sent, home, order.id);
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
    const { home, order } = await homeWithOrder(orgId, raws, await seedHome(orgId, 'signed', null));
    expect(await requestClientCode(home.delivery.rawToken, { purpose: 'decide_variation', target: order.id })).toEqual({ ok: false, error: 'no_channel' });
    expect(outbox.sent).toEqual([]);
    expect(await codesOf(home.delivery.id)).toEqual([]);
  });
});

describe('deciding (AC21 to AC23)', () => {
  it.each(['approve', 'reject'] as const)('AC21: the right code with a name, %s: one event, the code used up by it, the studio told; a replay is code_used', async (decision) => {
    const { home, order } = await homeWithOrder(orgId, raws);
    await expectDecidedOnce(home, order.id, decision);
  });

  it('AC25: a light delivery decides the same way', async () => {
    const { home, order } = await homeWithOrder(orgId, raws, await seedLightHome(orgId, 'signed'));
    await expectDecidedOnce(home, order.id, 'approve');
  });

  it('AC22: no name, a decision of maybe, a non-uuid id: refused before the database, no try spent, no event', async () => {
    const { home, order } = await homeWithOrder(orgId, raws);
    const { code } = await askForCode(outbox.sent, home, order.id);
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
    const { home, order } = await homeWithOrder(orgId, raws);
    const { code } = await askForCode(outbox.sent, home, order.id);
    for (const attemptsLeft of [4, 3, 2, 1, 0]) {
      expect(await decide(home, order.id, wrongOf(code))).toEqual({ ok: false, error: 'code_wrong', attemptsLeft });
    }
    expect(await decide(home, order.id, code)).toEqual({ ok: false, error: 'code_locked' });
    expect(await orderState(order.id)).toEqual({ status: 'issued', events: [] });
  });

  it("AC23: a signing code, or another order's, is code_unknown; another home's order is wrong_target, no try spent", async () => {
    const first = await homeWithOrder(orgId, raws);
    const second = await homeWithOrder(orgId, raws, first.home);
    const { code } = await askForCode(outbox.sent, first.home, first.order.id);
    expect(await decide(first.home, second.order.id, code)).toEqual({ ok: false, error: 'code_unknown' });
    const signing = await seedHome(orgId, 'issued');
    const signed = await homeWithOrder(orgId, raws, signing);
    const asked = await requestClientCode(signing.delivery.rawToken, { purpose: 'sign_contract', target: signing.contract.contractId });
    expect(asked.ok).toBe(true);
    expect(await decide(signing, signed.order.id, outbox.sent[outbox.sent.length - 1].code)).toEqual({ ok: false, error: 'code_unknown' });
    const foreign = await homeWithOrder(orgId, raws);
    expect(await decide(first.home, foreign.order.id, code)).toEqual({ ok: false, error: 'wrong_target' });
    expect((await codesOf(first.home.delivery.id))[0].attempts).toBe(0);
  });
});
