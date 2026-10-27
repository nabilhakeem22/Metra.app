import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H6.2 end to end, AC11 to AC19: the client signs the execution contract in
// the home through the REAL server actions (requestClientCode,
// signContractInHome) and the real database, with a FAKE sender in place of
// the email: Resend is never reached from a test. The fake keeps what it was
// handed, so a test can type the code the client would have read. Every token
// function the actions run is counted at lib/share/sdf-call (the real one,
// spied), so "no round trip" is measured, and its bound values are kept, so
// the raw code is shown never to leave the server.

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

import { acknowledgeContract } from '@/app/[locale]/c/[token]/actions';
import { requestClientCode } from '@/app/[locale]/d/[token]/code-actions';
import { signContractInHome } from '@/app/[locale]/d/[token]/contract-actions';
import { todayInCairo } from '@/lib/automation/clock';
import { getHomeByToken } from '@/lib/client-home/read';
import { getContractPage } from '@/lib/contracts/queries';
import { contractPayloadHash } from '@/lib/contracts/public';
import type { PublicContract } from '@/lib/contracts/public-types';
import { getExecutionFacts } from '@/lib/execution/queries/facts';
import { mintShareToken } from '@/lib/share/token';
import { codesOf, holdLock, seedHome, seedLightHome, type Home } from './client-home-fixture';
import { closeExecutionFixture, ownerQuery, seedClientProject, seedExecutionContract, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
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
  ownerId = seeded.ownerIds[0];
  orgIds.push(orgId);
});

afterEach(async () => {
  await tamper(`delete from public.client_verification_codes where org_id = $1`, [orgId]);
  // AC19: no code a test was sent appears in what it printed, or in any token function's bound values.
  const bound = JSON.stringify(sdfCalls.queries);
  for (const { code } of outbox.sent) {
    expect(printed).not.toContain(code);
    expect(bound).not.toContain(`"${code}"`);
  }
});

afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_APP_URL;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const NAME = ' \u202eهشام   عادل\u0000 ';
const SIGNED_AS = 'هشام عادل';

/** Ask for a signing code; the code the client would read in the email. */
async function askForCode(home: Home) {
  const answer = await requestClientCode(home.delivery.rawToken, { purpose: 'sign_contract', target: home.contract.contractId });
  if (!answer.ok) throw new Error(`no code: ${answer.error}`);
  return { code: outbox.sent[outbox.sent.length - 1].code, answer };
}

const sign = (home: Home, code: string, name: unknown = NAME, contractId: string = home.contract.contractId) =>
  signContractInHome(home.delivery.rawToken, { contractId, name: name as string, code });

const wrongOf = (code: string) => (code === '000000' ? '111111' : '000000');

/** /c's own snapshot of the contract: what its acknowledgement hashes. */
async function snapshotOfC(contractId: string): Promise<PublicContract> {
  const [row] = await ownerQuery<{ snapshot: PublicContract }>(
    `select public.app_contract_by_token(c.token_hash) as snapshot from public.contracts c where c.id = $1`,
    [contractId],
  );
  return row.snapshot;
}

async function contractState(contractId: string) {
  const [row] = await ownerQuery<{ status: string; events: Array<{ id: string; actor_name: string; pdf_hash: string }> | null; notified: number }>(
    `select c.status::text,
            (select json_agg(json_build_object('id', e.id, 'actor_name', e.actor_name, 'pdf_hash', e.pdf_hash))
               from public.contract_events e where e.contract_id = c.id and e.kind = 'acknowledged') as events,
            (select count(*)::int from public.notifications n where n.entity_id = c.id and n.body_key = 'client_contract_signed') as notified
       from public.contracts c where c.id = $1`,
    [contractId],
  );
  return { ...row, events: row.events ?? [] };
}

/** Signs as AC12 says, for any home: the act, the event, the hash, the code, the studio told, and a replay (signed already, F3). */
async function expectSignedOnce(home: Home) {
  const expectedHash = contractPayloadHash(await snapshotOfC(home.contract.contractId));
  const { code } = await askForCode(home);
  expect(await sign(home, code)).toEqual({ ok: true, already: false });
  const signed = await contractState(home.contract.contractId);
  expect(signed).toMatchObject({ status: 'signed', notified: 3 });
  expect(signed.events).toEqual([{ id: expect.any(String), actor_name: SIGNED_AS, pdf_hash: expectedHash }]);
  const [stored] = await codesOf(home.delivery.id);
  expect(stored.consumed_at).not.toBeNull();
  expect(stored.result_ref).toBe(signed.events[0].id);
  // Fix round F3: the snapshot read before the act already shows it signed, so the act is not sent.
  sdfCalls.queries.length = 0;
  expect(await sign(home, code)).toEqual({ ok: true, already: true });
  expect(JSON.stringify(sdfCalls.queries)).not.toContain('app_home_contract_ack_by_token');
  expect((await contractState(home.contract.contractId)).events).toHaveLength(1);
}

describe('the signing code (AC11, AC17)', () => {
  it('AC11: answers ok with the hint only; the email names C-YYYY-NNNN and links the signing on the Execution tab', async () => {
    const home = await seedHome(orgId);
    const { answer } = await askForCode(home);
    expect(answer).toEqual({ ok: true, hint: 'c•••@e•••.com', resendAfterSeconds: 60 });
    expect(outbox.sent).toEqual([
      expect.objectContaining({
        to: 'client.name@example.com',
        documentNumber: expect.stringMatching(/^C-\d{4}-\d{4}$/),
        homeUrl: `https://example.invalid/ar-EG/d/${home.delivery.rawToken}?tab=execution&focus=sign:${home.contract.contractId}`,
      }),
    ]);
    const [stored] = await codesOf(home.delivery.id);
    expect(stored).toMatchObject({ purpose: 'sign_contract', target_key: home.contract.contractId, attempts: 0 });
  });

  it('AC17: no email on file answers no_channel, writes no row and sends nothing', async () => {
    const home = await seedHome(orgId, 'issued', null);
    expect(await requestClientCode(home.delivery.rawToken, { purpose: 'sign_contract', target: home.contract.contractId })).toEqual({
      ok: false,
      error: 'no_channel',
    });
    expect(await codesOf(home.delivery.id)).toEqual([]);
    expect(outbox.sent).toEqual([]);
  });
});

describe('signing with the code (AC12 to AC17)', () => {
  it('AC12: the right code and a name sign once, as /c would hash it, the code used by the event, the studio told; a replay is already, with no act sent (F3)', async () => {
    await expectSignedOnce(await seedHome(orgId));
  });

  it('fix round F4: the studio sees the name the client signed with, on the contract page and in the cockpit', async () => {
    const home = await seedHome(orgId);
    const { code } = await askForCode(home);
    expect(await sign(home, code)).toEqual({ ok: true, already: false });
    const owner = ctxFor(orgId, ownerId, 'owner');
    const signed = { on: todayInCairo(new Date()), via: 'online', signerName: SIGNED_AS };
    expect((await getContractPage(owner, home.contract.contractId, true))?.signed).toEqual(signed);
    expect((await getExecutionFacts(owner, home.delivery.id)).signed).toEqual(signed);
  });

  it('AC17: a LIGHT delivery signs the same way', async () => {
    await expectSignedOnce(await seedLightHome(orgId));
  });

  it('AC13: a blank name is name_required with no round trip: no try spent, no event, nothing more in the outbox', async () => {
    const home = await seedHome(orgId);
    const { code } = await askForCode(home);
    sdfCalls.queries.length = 0;
    for (const name of ['', '   ', '\u200f\u0000', null]) expect(await sign(home, code, name)).toEqual({ ok: false, error: 'name_required' });
    expect(sdfCalls.queries).toEqual([]);
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ attempts: 0, consumed_at: null });
    expect(await contractState(home.contract.contractId)).toMatchObject({ status: 'issued', events: [] });
    expect(outbox.sent).toHaveLength(1);
  });

  it('AC14: five wrong codes count 4 to 0, then the right one is code_locked; the contract stays issued', async () => {
    const home = await seedHome(orgId);
    const { code } = await askForCode(home);
    const left: unknown[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const answer = await sign(home, wrongOf(code));
      expect(answer).toMatchObject({ ok: false, error: 'code_wrong' });
      left.push((answer as { attemptsLeft?: number }).attemptsLeft);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect(await sign(home, code)).toEqual({ ok: false, error: 'code_locked' });
    expect(await contractState(home.contract.contractId)).toMatchObject({ status: 'issued', events: [] });
  });

  it('AC15: the window closing after the code was sent is signing_closed, the code kept, the home at signing_closed; no new code then', async () => {
    const home = await seedHome(orgId);
    const { code } = await askForCode(home);
    await tamper(`update public.contracts set share_expires_at = now() - interval '1 second' where id = $1`, [home.contract.contractId]);
    expect(await sign(home, code)).toEqual({ ok: false, error: 'signing_closed' });
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ consumed_at: null });
    const read = await getHomeByToken(home.delivery.rawToken);
    expect(read.status === 'ok' && read.home.execution?.location.reason).toBe('signing_closed');
    await tamper(`delete from public.client_verification_codes where org_id = $1`, [orgId]);
    expect(await requestClientCode(home.delivery.rawToken, { purpose: 'sign_contract', target: home.contract.contractId })).toEqual({
      ok: false,
      error: 'not_available',
    });
    expect(await codesOf(home.delivery.id)).toEqual([]);
    expect(outbox.sent).toHaveLength(1);
  });

  it('AC16: another home\'s contract is refused with no try spent and the act never sent; an id that is not a uuid reads nothing', async () => {
    const home = await seedHome(orgId);
    const other = await seedHome(orgId);
    const { code } = await askForCode(home);
    sdfCalls.queries.length = 0;
    // The app reads the home's snapshot to hash it; it is not that contract, so the act is not sent (contract_inactive).
    expect(await sign(home, code, NAME, other.contract.contractId)).toEqual({ ok: false, error: 'contract_inactive' });
    expect(JSON.stringify(sdfCalls.queries)).not.toContain('app_home_contract_ack_by_token');
    expect((await codesOf(home.delivery.id))[0].attempts).toBe(0);
    sdfCalls.queries.length = 0;
    expect(await sign(home, code, NAME, 'not-a-contract')).toEqual({ ok: false, error: 'wrong_target' });
    expect(sdfCalls.queries).toEqual([]);
    expect(await contractState(other.contract.contractId)).toMatchObject({ status: 'issued', events: [] });
  });

  it('AC18: a contract row held FOR UPDATE past the 4 s wait is busy: no 55P03 escapes, the code unused and untried, and it signs after', async () => {
    const home = await seedHome(orgId);
    const { code } = await askForCode(home);
    const hold = await holdLock(`select 1 from public.contracts where id = $1 for update`, [home.contract.contractId], 7000);
    const held = await sign(home, code);
    await hold.release();
    expect(held).toEqual({ ok: false, error: 'busy' });
    expect(printed).not.toContain('55P03');
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ attempts: 0, consumed_at: null });
    expect(await sign(home, code)).toEqual({ ok: true, already: false });
  }, 20_000);
});

describe('/c is as it was (AC19)', () => {
  it('acknowledges a BOQ contract with no code (the interim gap until H6.3), hashing its own snapshot', async () => {
    const contract = await seedExecutionContract(orgId, { project: await seedClientProject(orgId) });
    const expectedHash = contractPayloadHash(await snapshotOfC(contract.contractId));
    expect(await acknowledgeContract(contract.rawToken as string, 'Link Client')).toEqual({ ok: true });
    const state = await contractState(contract.contractId);
    expect(state).toMatchObject({ status: 'signed', events: [{ actor_name: 'Link Client', pdf_hash: expectedHash }] });
    expect(await acknowledgeContract(contract.rawToken as string, 'Link Client')).toEqual({ ok: false, error: 'already_responded' });
  });

  it('acknowledges a proposal contract as before', async () => {
    const { clientId, projectId } = await seedClientProject(orgId);
    const [proposal] = await ownerQuery<{ id: string }>(
      `insert into public.proposals (org_id, number, title_en, client_id, project_id, status)
       values ($1, 800000 + floor(random() * 99999)::int, 'Quote', $2, $3, 'accepted') returning id`,
      [orgId, clientId, projectId],
    );
    const token = mintShareToken();
    const [contract] = await ownerQuery<{ id: string }>(
      `insert into public.contracts (org_id, number, title_en, source_proposal_id, client_id, project_id,
                                     status, token_hash, share_expires_at)
       values ($1, 700000 + floor(random() * 99999)::int, 'Quote contract', $2, $3, $4, 'draft', $5,
               now() + interval '30 days') returning id`,
      [orgId, proposal.id, clientId, projectId, token.hash],
    );
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [contract.id]);
    expect(await acknowledgeContract(token.raw, 'Quote Client')).toEqual({ ok: true });
    expect(await contractState(contract.id)).toMatchObject({ status: 'signed', events: [{ actor_name: 'Quote Client' }] });
  });
});
