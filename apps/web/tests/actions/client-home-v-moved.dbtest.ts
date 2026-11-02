import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H7.2 end to end (AC19): /v's own decision answers `moved` for a BOQ contract's
// change order, whatever its home, and nothing is written: no status change, no
// event, nobody told. A proposal contract's order still decides there, with no code.

vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest-client', 'cf-connecting-ip': '10.1.2.3' }) }));

import { respondToVariation } from '@/app/[locale]/v/[token]/actions';
import type { OrgContext } from '@/lib/db/context';
import { revokeDeliveryLinkCore } from '@/lib/engagements/share';
import { mintShareToken } from '@/lib/share/token';
import { mintHomeLink } from './client-home-c-link-fixture';
import { seedHome } from './client-home-fixture';
import { seedProposalContract } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery, seedVariation } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
let owner: OrgContext;

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const seeded = await seedOrg({ owners: 1 });
  owner = ctxFor(seeded.orgId, seeded.ownerIds[0], 'owner');
  orgIds.push(seeded.orgId);
});

beforeEach(() => {
  process.env.SHARE_LINK_SECRET = 'h7-share-link-secret-0123456789abcdef0123456789ab';
});

afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env.SHARE_LINK_SECRET;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** A home with its client link minted, and one open order. */
async function liveHome() {
  const home = await seedHome(owner.orgId, 'signed');
  await mintHomeLink(owner, home);
  const link = mintShareToken();
  const order = await seedVariation(owner.orgId, home.contract, 'issued', { tokenHash: link.hash });
  return { home, order: { id: order.id, raw: link.raw } };
}

describe('/v after H7.2 (AC19)', () => {
  const stateOf = async (orderId: string, contractId: string) => {
    const [row] = await ownerQuery<{ status: string; events: number; told: number }>(
      `select v.status::text,
              (select count(*)::int from public.variation_order_events e where e.variation_order_id = v.id and e.kind in ('approved', 'rejected')) as events,
              (select count(*)::int from public.notifications n where n.entity_id = $2 and n.body_key like 'client_variation_%') as told
         from public.variation_orders v where v.id = $1`,
      [orderId, contractId],
    );
    return row;
  };

  it.each(['with', 'without'] as const)('a BOQ order %s a home: moved; nothing changes, nobody is told', async (kind) => {
    const { home, order } = await liveHome();
    if (kind === 'without') await revokeDeliveryLinkCore(owner, home.delivery.id);
    expect(await respondToVariation(order.raw, 'approve', 'Link Client')).toEqual({ ok: false, error: 'moved' });
    expect(await stateOf(order.id, home.contract.contractId)).toEqual({ status: 'issued', events: 0, told: 0 });
  });

  it('a proposal order approves with one event; a second call is already_responded', async () => {
    const contractId = await seedProposalContract(owner.orgId);
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [contractId]);
    const [project] = await ownerQuery<{ project_id: string }>(`select project_id from public.contracts where id = $1`, [contractId]);
    const link = mintShareToken();
    const order = await seedVariation(owner.orgId, { contractId, projectId: project.project_id }, 'issued', { tokenHash: link.hash });
    expect(await respondToVariation(link.raw, 'approve', 'Link Client')).toEqual({ ok: true });
    expect(await stateOf(order.id, contractId)).toMatchObject({ status: 'approved', events: 1 });
    expect(await respondToVariation(link.raw, 'reject', 'Link Client')).toEqual({ ok: false, error: 'already_responded' });
    expect(await stateOf(order.id, contractId)).toMatchObject({ status: 'approved', events: 1 });
  });
});
