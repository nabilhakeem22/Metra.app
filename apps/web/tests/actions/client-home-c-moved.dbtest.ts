import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// H6.3 end to end (AC8): /c's acknowledgement refuses a BOQ contract with
// `moved` (it is signed in the client home with a code), whatever its home and
// its state, and nothing is written: no status change, no event, no
// notification. A proposal contract still acknowledges on /c, once (OD3).

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest-client', 'cf-connecting-ip': '10.1.2.3' }) }));

import { acknowledgeContract } from '@/app/[locale]/c/[token]/actions';
import type { OrgContext } from '@/lib/db/context';
import { contractPayloadHash } from '@/lib/contracts/public';
import type { PublicContract } from '@/lib/contracts/public-types';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { mintShareToken } from '@/lib/share/token';
import { seedHome } from './client-home-fixture';
import { closeExecutionFixture, ownerQuery, seedClientProject, seedExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
let owner: OrgContext;

beforeAll(async () => {
  process.env.SHARE_LINK_SECRET = 'h63-share-link-secret-0123456789abcdef0123456789';
  const seeded = await seedOrg({ owners: 1 });
  owner = ctxFor(seeded.orgId, seeded.ownerIds[0], 'owner');
  orgIds.push(seeded.orgId);
});

afterAll(async () => {
  delete process.env.SHARE_LINK_SECRET;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** The contract's status, its `acknowledged` events and the notifications about it. */
async function written(contractId: string) {
  const [row] = await ownerQuery<{ status: string; events: Array<{ actor_name: string; pdf_hash: string }> | null; notified: number }>(
    `select c.status::text,
            (select json_agg(json_build_object('actor_name', e.actor_name, 'pdf_hash', e.pdf_hash))
               from public.contract_events e where e.contract_id = c.id and e.kind = 'acknowledged') as events,
            (select count(*)::int from public.notifications n where n.entity_id = c.id) as notified
       from public.contracts c where c.id = $1`,
    [contractId],
  );
  return { ...row, events: row.events ?? [] };
}

async function expectMoved(rawToken: string, contractId: string, status: string) {
  const before = await written(contractId);
  expect(await acknowledgeContract(rawToken, 'Link Client')).toEqual({ ok: false, error: 'moved' });
  expect(await written(contractId)).toEqual({ ...before, status });
}

describe('a BOQ contract on /c answers moved, and nothing is written', () => {
  it('with a home whose link re-derives', async () => {
    const home = await seedHome(owner.orgId, 'issued');
    await ownerQuery(`update public.design_engagements set token_hash = null, token_nonce = null where id = $1`, [home.delivery.id]);
    expect((await mintDeliveryLinkCore(owner, home.delivery.id)).ok).toBe(true);
    await expectMoved(home.contract.rawToken as string, home.contract.contractId, 'issued');
  });

  it('with no home at all, and once signed', async () => {
    const issued = await seedExecutionContract(owner.orgId, { project: await seedClientProject(owner.orgId) });
    await expectMoved(issued.rawToken as string, issued.contractId, 'issued');
    const signed = await seedHome(owner.orgId, 'signed');
    await expectMoved(signed.contract.rawToken as string, signed.contract.contractId, 'signed');
  });
});

describe('a proposal contract still acknowledges on /c (OD3)', () => {
  it('once, with the hash of its own snapshot; a second time is already_responded', async () => {
    const { clientId, projectId } = await seedClientProject(owner.orgId);
    const [proposal] = await ownerQuery<{ id: string }>(
      `insert into public.proposals (org_id, number, title_en, client_id, project_id, status)
       values ($1, 810000 + floor(random() * 99999)::int, 'Quote', $2, $3, 'accepted') returning id`,
      [owner.orgId, clientId, projectId],
    );
    const token = mintShareToken();
    const [contract] = await ownerQuery<{ id: string }>(
      `insert into public.contracts (org_id, number, title_en, source_proposal_id, client_id, project_id,
                                     status, token_hash, share_expires_at)
       values ($1, 710000 + floor(random() * 99999)::int, 'Quote contract', $2, $3, $4, 'draft', $5,
               now() + interval '30 days') returning id`,
      [owner.orgId, proposal.id, clientId, projectId, token.hash],
    );
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [contract.id]);
    const [{ snapshot }] = await ownerQuery<{ snapshot: PublicContract }>(`select public.app_contract_by_token($1) as snapshot`, [token.hash]);
    expect(await acknowledgeContract(token.raw, 'Quote Client')).toEqual({ ok: true });
    expect(await written(contract.id)).toMatchObject({
      status: 'signed',
      events: [{ actor_name: 'Quote Client', pdf_hash: contractPayloadHash(snapshot) }],
    });
    expect(await acknowledgeContract(token.raw, 'Quote Client')).toEqual({ ok: false, error: 'already_responded' });
    expect((await written(contract.id)).events).toHaveLength(1);
  });
});
