import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H5 end to end, AC7 to AC14: the client's code request and "I paid" through
// the REAL server actions (requestClientCode, claimRequestInHome,
// claimDesignPaymentInHome) and the real database, with a FAKE sender in place
// of the email: Resend is never reached from a test. The fake keeps what it
// was handed, so a test can type the code the client would have read.

const outbox = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; code: string; documentNumber: string; studioName: string; homeUrl: string }>,
  working: true,
}));
vi.mock('@/lib/email/client-code', () => ({
  sendClientCodeEmail: async (input: { to: string; code: string; documentNumber: string; studioName: string; homeUrl: string }) => {
    if (!outbox.working) return { sent: false, transient: false, refusal: { statusCode: 403, name: 'validation_error' } };
    outbox.sent.push(input);
    return { sent: true };
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest-client', 'cf-connecting-ip': '10.1.2.3' }) }));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.invalid';
});

import { claimDesignPaymentInHome } from '@/app/[locale]/d/[token]/actions';
import { requestClientCode } from '@/app/[locale]/d/[token]/code-actions';
import { claimRequestInHome } from '@/app/[locale]/d/[token]/execution-actions';
import { ageCodes, codesOf, seedHome, setClientEmail } from './client-home-fixture';
import { claimNotifications, claimsOf, seedDelivery } from './delivery-execution-fixture';
import { seedPayment } from './execution-billing-fixture';
import { closeExecutionFixture, ownerQuery, seedRequest, seedVariation, tamper } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
let orgId: string;
let members: { owner: string; admin: string; accountant: string };
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
  outbox.working = true;
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }, { role: 'accountant' }, { role: 'project_manager' }] });
  orgId = seeded.orgId;
  const [admin, accountant] = seeded.memberIds;
  members = { owner: seeded.ownerIds[0], admin, accountant };
  orgIds.push(orgId);
});

afterEach(async () => {
  await tamper(`delete from public.client_verification_codes where org_id = $1`, [orgId]);
  // AC14: whatever a test printed, no code it was sent appears in it.
  for (const { code } of outbox.sent) expect(printed).not.toContain(code);
});

afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_APP_URL;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** A signed home with one request of 62,000 of which 2,000 is paid: 60,000 still due. */
async function homeWithRequest() {
  const home = await seedHome(orgId, 'signed');
  const requestId = await seedRequest(orgId, home.contract.contractId, members.owner, { milestoneId: home.contract.milestoneIds[0] }, '62000');
  await seedPayment(orgId, home.contract.contractId, requestId, members.owner, '2000');
  return { home, requestId, token: home.delivery.rawToken };
}

/** Ask for a code for the request; the code the client would read in the email. */
async function askForCode(token: string, requestId: string) {
  const answer = await requestClientCode(token, { purpose: 'claim_request', target: requestId });
  if (!answer.ok) throw new Error(`no code: ${answer.error}`);
  return { code: outbox.sent[outbox.sent.length - 1].code, answer };
}

const wrongOf = (code: string) => (code === '000000' ? '111111' : '000000');

describe('the code request (AC7, AC8, AC9)', () => {
  it('sends the code to the address on file and tells the browser only the hint', async () => {
    const { home, requestId, token } = await homeWithRequest();
    const { answer } = await askForCode(token, requestId);
    expect(answer).toEqual({ ok: true, hint: 'c•••@e•••.com', resendAfterSeconds: 60 });
    expect(outbox.sent).toEqual([
      {
        to: 'client.name@example.com',
        code: expect.stringMatching(/^\d{6}$/),
        purpose: 'claim_request',
        documentNumber: expect.stringMatching(/^PR-\d{4}-\d{4}$/),
        studioName: expect.any(String),
        homeUrl: `https://example.invalid/ar-EG/d/${token}?tab=execution&focus=request:${requestId}`,
        locale: 'ar-EG',
      },
    ]);
    expect(JSON.stringify(answer)).not.toContain('client.name@example.com');
    const [stored] = await codesOf(home.delivery.id);
    expect(stored).toMatchObject({ purpose: 'claim_request', target_key: requestId, actor_ip: '10.1.2.3', actor_user_agent: 'vitest-client' });
    expect(JSON.stringify(answer)).not.toContain(stored.id);
  });

  it('AC7: no email on file answers no_channel, writes no row and sends nothing', async () => {
    const home = await seedHome(orgId, 'signed', null);
    const requestId = await seedRequest(orgId, home.contract.contractId, members.owner, { milestoneId: home.contract.milestoneIds[0] }, '100');
    expect(await requestClientCode(home.delivery.rawToken, { purpose: 'claim_request', target: requestId })).toEqual({ ok: false, error: 'no_channel' });
    expect(await codesOf(home.delivery.id)).toEqual([]);
    expect(outbox.sent).toEqual([]);
  });

  it('AC8: a second request for the same target within 60 s is too_many with at most 60 s to wait, and is logged', async () => {
    const { requestId, token } = await homeWithRequest();
    await askForCode(token, requestId);
    const second = await requestClientCode(token, { purpose: 'claim_request', target: requestId });
    expect(second).toMatchObject({ ok: false, error: 'too_many', limit: 'target_spacing' });
    const wait = (second as { retryAfterSeconds: number }).retryAfterSeconds;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    expect(printed).toContain('client code request refused:');
    expect(outbox.sent).toHaveLength(1);
  });

  it('AC9: a paid request, or one of another contract, is not_available with no row and no email', async () => {
    const { home, token } = await homeWithRequest();
    const paid = await seedRequest(orgId, home.contract.contractId, members.owner, { milestoneId: home.contract.milestoneIds[1] }, '100');
    await seedPayment(orgId, home.contract.contractId, paid, members.owner, '100');
    const other = await seedHome(orgId, 'signed');
    const foreign = await seedRequest(orgId, other.contract.contractId, members.owner, { milestoneId: other.contract.milestoneIds[0] }, '100');
    for (const target of [paid, foreign]) {
      expect(await requestClientCode(token, { purpose: 'claim_request', target })).toEqual({ ok: false, error: 'not_available' });
    }
    expect(await codesOf(home.delivery.id)).toEqual([]);
    expect(outbox.sent).toEqual([]);
  });

  it('a send that failed answers send_failed with the 60 s spacing; the code is marked unsent and authorises nothing (H5 R1, F2)', async () => {
    const { home, requestId, token } = await homeWithRequest();
    outbox.working = false;
    expect(await requestClientCode(token, { purpose: 'claim_request', target: requestId })).toEqual({
      ok: false,
      error: 'send_failed',
      resendAfterSeconds: 60,
    });
    const [unsent] = await codesOf(home.delivery.id);
    expect(unsent.consumed_at).not.toBeNull();
    expect(unsent.result_ref).toBe(unsent.id);
    expect(printed).toContain('client code email not sent');
    expect(printed).toContain('"statusCode":403');
    outbox.working = true;
    expect(await requestClientCode(token, { purpose: 'claim_request', target: requestId })).toMatchObject({
      ok: false,
      error: 'too_many',
      limit: 'target_spacing',
    });
    await ageCodes(home.delivery.id, 61);
    const { code } = await askForCode(token, requestId);
    expect(await claimRequestInHome(token, { requestId, code })).toEqual({ ok: true, already: false });
  });

  it('R1: 25 failed sends in one studio spend none of its day: the next client of that studio gets a code', async () => {
    const { home, token } = await homeWithRequest();
    const requests: string[] = [];
    for (let index = 0; index < 26; index += 1) {
      const order = await seedVariation(orgId, home.contract, 'approved');
      requests.push(await seedRequest(orgId, home.contract.contractId, members.owner, { variationOrderId: order.id }, '10'));
    }
    outbox.working = false;
    for (const target of requests.slice(0, 25)) {
      expect(await requestClientCode(token, { purpose: 'claim_request', target })).toMatchObject({ ok: false, error: 'send_failed' });
    }
    outbox.working = true;
    expect((await askForCode(token, requests[25])).answer).toMatchObject({ ok: true });
    const other = await homeWithRequest();
    expect((await askForCode(other.token, other.requestId)).answer).toMatchObject({ ok: true });
    expect(await codesOf(home.delivery.id)).toHaveLength(26);
  });
});

describe('"I paid" with the code (AC10 to AC13)', () => {
  it('AC10: wrong codes count 4 to 0 and each try is kept; then even the right code is code_locked, and nothing is claimed', async () => {
    const { home, requestId, token } = await homeWithRequest();
    const { code } = await askForCode(token, requestId);
    const left: unknown[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const answer = await claimRequestInHome(token, { requestId, code: wrongOf(code) });
      expect(answer).toMatchObject({ ok: false, error: 'code_wrong' });
      left.push((answer as { attemptsLeft: number }).attemptsLeft);
      expect((await codesOf(home.delivery.id))[0].attempts).toBe(attempt + 1);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect(await claimRequestInHome(token, { requestId, code })).toEqual({ ok: false, error: 'code_locked' });
    expect(await claimsOf(home.contract.contractId)).toEqual([]);
  });

  it('a code that is not six digits is code_wrong and spends no try', async () => {
    const { home, requestId, token } = await homeWithRequest();
    await askForCode(token, requestId);
    expect(await claimRequestInHome(token, { requestId, code: '12' })).toEqual({ ok: false, error: 'code_wrong' });
    expect((await codesOf(home.delivery.id))[0].attempts).toBe(0);
  });

  it('AC11: after 10 minutes the right code is code_expired; a code of another act or another delivery is code_unknown', async () => {
    const { home, requestId, token } = await homeWithRequest();
    const forRequest = await askForCode(token, requestId);
    const otherDelivery = await homeWithRequest();
    expect(await claimRequestInHome(otherDelivery.token, { requestId: otherDelivery.requestId, code: forRequest.code })).toEqual({
      ok: false,
      error: 'code_unknown',
    });
    const design = await seedDelivery(orgId, { state: 'design_proposal' });
    await ownerQuery(`update public.design_engagements set design_fee = 10000 where id = $1`, [design.id]);
    await ownerQuery(`insert into public.engagement_milestones (org_id, engagement_id, kind, basis, value) values ($1, $2, 'deposit', 'percent', 30)`, [
      orgId,
      design.id,
    ]);
    expect(
      await claimDesignPaymentInHome(home.delivery.rawToken, { milestoneKind: 'deposit', code: forRequest.code }),
    ).toMatchObject({ ok: false, error: 'code_unknown' });
    await ageCodes(home.delivery.id, 601);
    expect(await claimRequestInHome(token, { requestId, code: forRequest.code })).toEqual({
      ok: false,
      error: 'code_expired',
    });
    expect(await claimsOf(home.contract.contractId)).toEqual([]);
  });

  it('AC12, AC13: the right code claims the full outstanding once, tells the studio, uses the code up; a replay is code_used', async () => {
    const { home, requestId, token } = await homeWithRequest();
    const { code } = await askForCode(token, requestId);
    const answer = await claimRequestInHome(token, { requestId, code });
    expect(answer).toEqual({ ok: true, already: false });
    const claims = await claimsOf(home.contract.contractId);
    expect(claims.map((claim) => [claim.request_id, claim.claimed_amount, claim.status])).toEqual([[requestId, '60000.0000', 'pending']]);
    expect((await claimNotifications(home.contract.contractId)).map((row) => row.recipient_user_id).sort()).toEqual(
      [members.owner, members.admin, members.accountant].sort(),
    );
    const [stored] = await codesOf(home.delivery.id);
    expect(stored.consumed_at).not.toBeNull();
    expect(stored.result_ref).toBe(claims[0].id);
    expect(await claimRequestInHome(token, { requestId, code })).toEqual({ ok: false, error: 'code_used' });
    expect(await claimsOf(home.contract.contractId)).toHaveLength(1);
    expect(JSON.stringify(answer)).not.toContain(code);
  });

  it('a design-fee instalment: the right code claims it and the studio is told; with no email the client is told so', async () => {
    const design = await seedDelivery(orgId, { state: 'design_proposal' });
    await ownerQuery(`update public.design_engagements set design_fee = 10000 where id = $1`, [design.id]);
    await ownerQuery(`insert into public.engagement_milestones (org_id, engagement_id, kind, basis, value) values ($1, $2, 'deposit', 'percent', 30)`, [
      orgId,
      design.id,
    ]);
    expect(await requestClientCode(design.rawToken, { purpose: 'claim_design_payment', target: 'deposit' })).toEqual({ ok: false, error: 'no_channel' });
    await setClientEmail(orgId, design.clientId, 'design.client@example.com');
    const asked = await requestClientCode(design.rawToken, { purpose: 'claim_design_payment', target: 'deposit' });
    if (!asked.ok) throw new Error(asked.error);
    expect(outbox.sent[0]).toMatchObject({
      to: 'design.client@example.com',
      documentNumber: expect.stringMatching(/^DE-/),
      homeUrl: `https://example.invalid/ar-EG/d/${design.rawToken}?tab=design&focus=instalment:deposit`,
    });
    const answer = await claimDesignPaymentInHome(design.rawToken, { milestoneKind: 'deposit', code: outbox.sent[0].code });
    expect(answer).toEqual({ ok: true, already: false, studioNotified: true });
    const claims = await ownerQuery<{ id: string; claimed_amount: string }>(`select id, claimed_amount::text from public.client_payment_claims where engagement_id = $1`, [
      design.id,
    ]);
    expect(claims.map((claim) => claim.claimed_amount)).toEqual(['3000.0000']);
    expect((await codesOf(design.id))[0].result_ref).toBe(claims[0].id);
  });
});

describe('F1: the code does not depend on the page that asked for it', () => {
  it('a client back from the email (a fresh page, no memory of the request) types the code and it claims', async () => {
    const { home, requestId, token } = await homeWithRequest();
    await requestClientCode(token, { purpose: 'claim_request', target: requestId });
    const emailed = outbox.sent[0];
    expect(emailed.homeUrl).toBe(`https://example.invalid/ar-EG/d/${token}?tab=execution&focus=request:${requestId}`);
    // The reloaded page sends only the request and the code it was typed.
    expect(await claimRequestInHome(token, { requestId: requestId.toUpperCase(), code: emailed.code })).toEqual({ ok: true, already: false });
    expect(await claimsOf(home.contract.contractId)).toHaveLength(1);
  });
});
