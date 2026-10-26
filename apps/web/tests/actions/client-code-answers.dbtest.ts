import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { terminateContractCore } from '@/lib/contracts/lifecycle/terminate';
import type { OrgContext } from '@/lib/db/context';
import {
  ageCodes,
  claimDesignWithCode,
  claimRequestWithCode,
  codesOf,
  decideWithCode,
  requestCode,
  seedHome,
  setClientEmail,
  signWithCode,
  type Home,
} from './client-home-fixture';
import { seedDelivery } from './delivery-execution-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedRequest, seedVariation, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// Client home DB step C, the H3 fix round on the act wrappers' answers
// (rls/functions/75-client-home.sql): one meaning per code.
//  - F1: `already` only when the act IS done; a terminated or replaced contract
//    is `contract_inactive`, the change-order wrapper's code;
//  - F2: an expired home link is `token_expired`, a closed signing window
//    `signing_closed`, a lapsed change-order link `link_expired`;
//  - reliability note 1, F8: a code is consumed only by the act it authorised,
//    so a contract the studio signed on paper, or another code signed, leaves
//    it unused.

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }, { role: 'project_manager' }] });
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  orgIds.push(orgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** An issued home contract with a code sent to sign it. */
async function homeWithSignCode(): Promise<Home & { challengeId: string; code: string }> {
  const home = await seedHome(orgId, 'issued');
  const issued = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
  expect(issued.answer.status).toBe('ok');
  return { ...home, challengeId: issued.challengeId, code: issued.code };
}

const sign = (home: Home & { challengeId: string; code: string }) =>
  signWithCode(home.delivery.tokenHash, home.contract.contractId, home.challengeId, home.code);

/** The studio records the paper signature, as recordContractSignedOfflineCore writes it. */
async function signOnPaper(contractId: string): Promise<void> {
  await ownerQuery(`update public.contracts set status = 'signed' where id = $1`, [contractId]);
  await ownerQuery(
    `insert into public.contract_events (org_id, contract_id, kind, actor_user_id, from_status, to_status)
     values ($1, $2, 'acknowledged_offline', $3, 'issued', 'signed')`,
    [orgId, contractId, owner.userId],
  );
}

describe('F1: signing a contract that is no longer issued', () => {
  it('terminated after the code was sent: contract_inactive, the code unused', async () => {
    const home = await homeWithSignCode();
    expect((await terminateContractCore(owner, { id: home.contract.contractId })).ok).toBe(true);
    expect(await sign(home)).toEqual({ code: 'contract_inactive' });
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ consumed_at: null, result_ref: null, attempts: 0 });
  });

  it('terminated and replaced by a newer issued BOQ: contract_inactive, not the home\'s contract any more', async () => {
    const home = await homeWithSignCode();
    expect((await terminateContractCore(owner, { id: home.contract.contractId })).ok).toBe(true);
    await ownerQuery(`update public.boqs set status = 'superseded' where id = $1`, [home.contract.boqId]);
    await seedExecutionContract(orgId, { state: 'issued', delivery: home.delivery });
    expect(await sign(home)).toEqual({ code: 'contract_inactive' });
    expect((await codesOf(home.delivery.id))[0].consumed_at).toBeNull();
  });

  it('signed on paper after the code was sent: already, and the code is not consumed by the studio\'s event', async () => {
    const home = await homeWithSignCode();
    await signOnPaper(home.contract.contractId);
    expect(await sign(home)).toEqual({ code: 'already' });
    expect((await codesOf(home.delivery.id))[0]).toMatchObject({ consumed_at: null, result_ref: null });
  });

  it('signed online with another code: already, and the second code claims nothing', async () => {
    const home = await homeWithSignCode();
    await ageCodes(home.delivery.id, 61);
    const second = await requestCode(home.delivery.tokenHash, 'sign_contract', home.contract.contractId);
    expect(await sign(home)).toEqual({ code: 'ok' });
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, second.challengeId, second.code)).toEqual({ code: 'already' });
    const [first, other] = await codesOf(home.delivery.id);
    expect(first.result_ref).not.toBeNull();
    expect(other).toMatchObject({ id: second.challengeId, consumed_at: null, result_ref: null });
  });
});

describe('F2: three kinds of "expired", three codes', () => {
  it('the home link expired: token_expired on every act', async () => {
    const home = await seedHome(orgId, 'signed');
    const request = await seedRequest(orgId, home.contract.contractId, owner.userId, { milestoneId: home.contract.milestoneIds[0] }, '100');
    const order = await seedVariation(orgId, home.contract, 'issued', { tokenHash: `${randomUUID()}-expiry` });
    await tamper(`update public.design_engagements set share_expires_at = now() - interval '1 second' where id = $1`, [home.delivery.id]);
    const challenge = randomUUID();
    expect(await signWithCode(home.delivery.tokenHash, home.contract.contractId, challenge, '123456')).toEqual({ code: 'token_expired' });
    expect(await decideWithCode(home.delivery.tokenHash, order.id, 'approve', challenge, '123456')).toEqual({ code: 'token_expired' });
    expect(await claimRequestWithCode(home.delivery.tokenHash, request, challenge, '123456')).toEqual({ code: 'token_expired' });
    const designing = await seedDelivery(orgId, { state: 'design_proposal', expired: true });
    expect(await claimDesignWithCode(designing.tokenHash, 'deposit', challenge, '123456')).toEqual({ code: 'token_expired' });
  });

  it('the contract\'s signing window closed: signing_closed, the code unused', async () => {
    const home = await homeWithSignCode();
    await tamper(`update public.contracts set share_expires_at = now() - interval '1 second' where id = $1`, [home.contract.contractId]);
    expect(await sign(home)).toEqual({ code: 'signing_closed' });
    expect((await codesOf(home.delivery.id))[0].consumed_at).toBeNull();
  });

  it('the change order\'s link lapsed: link_expired, the code unused', async () => {
    const home = await seedHome(orgId, 'signed');
    await setClientEmail(orgId, home.delivery.clientId, 'client@example.com');
    const order = await seedVariation(orgId, home.contract, 'issued', { tokenHash: `${randomUUID()}-lapse` });
    const issued = await requestCode(home.delivery.tokenHash, 'decide_variation', order.id);
    await tamper(`update public.variation_orders set share_expires_at = now() - interval '1 second' where id = $1`, [order.id]);
    expect(await decideWithCode(home.delivery.tokenHash, order.id, 'approve', issued.challengeId, issued.code)).toEqual({ code: 'link_expired' });
    expect((await codesOf(home.delivery.id))[0].consumed_at).toBeNull();
  });
});
