import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Where H7 meets design first: a delivery closed as design only that went on to
// execution keeps its one row and its one link, and the client decides a change
// order in that home with that link, through the REAL server actions and the
// real database. A FAKE sender stands in for the email: Resend is never reached.

const outbox = vi.hoisted(() => ({ sent: [] as Array<{ code: string }> }));
vi.mock('@/lib/email/client-code', () => ({
  sendClientCodeEmail: async (input: { code: string }) => {
    outbox.sent.push(input);
    return { sent: true };
  },
}));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'user-agent': 'vitest-client', 'cf-connecting-ip': '10.1.2.3' }) }));
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://example.invalid';
  process.env.SHARE_LINK_SECRET = 'h7-continued-share-link-secret-0123456789abcdef';
});

import { readHomeView } from '@/app/[locale]/d/[token]/home-read';
import { variationLinkLanding } from '@/lib/client-home/redirect-variation';
import type { OrgContext } from '@/lib/db/context';
import { executeTransition } from '@/lib/engagements/executor';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { hashShareToken } from '@/lib/share/token';
import { getVariationByToken } from '@/lib/variations/public';
import { seedDelivery } from './contract-from-boq-fixture';
import { askForCode, DECIDED_AS, decide, homeWithOrder, orderState } from './client-home-decide-fixture';
import { setClientEmail, type Home } from './client-home-fixture';
import { projectRows } from './design-first-fixture';
import { seedBillableContract } from './execution-billing-fixture';
import { closeExecutionFixture, seedClientProject, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: [{ role: 'admin' }, { role: 'project_manager' }] });
  orgId = seeded.orgId;
  orgIds.push(orgId);
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
});

afterAll(async () => {
  await tamper(`delete from public.client_verification_codes where org_id = $1`, [orgId]);
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.SHARE_LINK_SECRET;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

describe('a design-only delivery that continued to execution', () => {
  it('decides a change order of its signed contract in the home, on the link it had in design, and token_hash does not change', async () => {
    const pair = await seedClientProject(orgId);
    const deliveryId = await seedDelivery(orgId, pair, 'closed_design_only');
    await setClientEmail(orgId, pair.clientId, 'continued@example.org');
    const link = (await mintDeliveryLinkCore(owner, deliveryId)).data as string;
    const [inDesign] = await projectRows(pair.projectId);
    expect(inDesign.token_hash).toBe(hashShareToken(link));
    expect((await readHomeView(link, null)).tab).toBe('design');

    expect(await executeTransition(owner, { engagementId: deliveryId, trigger: 'continueToExecution' })).toMatchObject({ ok: true });
    const contract = await seedBillableContract(orgId, 'signed', { id: deliveryId, ...pair });
    const home: Home = { delivery: { id: deliveryId, ...pair, rawToken: link, tokenHash: inDesign.token_hash as string }, contract };
    const { order, link: orderLink } = await homeWithOrder(orgId, [], home);

    const before = await readHomeView(link, null);
    if (before.tab !== 'execution' || !before.changeOrders) throw new Error('the home does not list the order');
    expect(before.changeOrders.map((listed) => listed.id)).toEqual([order.id]);
    expect((await variationLinkLanding(orderLink.raw, await getVariationByToken(orderLink.raw), 'en')).homePath).toBe(
      `/en/d/${link}?tab=execution&focus=variation:${order.id}`,
    );

    const { code } = await askForCode(outbox.sent, home, order.id);
    expect(await decide(home, order.id, code)).toEqual({ ok: true, already: false });

    const decided = await orderState(order.id);
    expect(decided.status).toBe('approved');
    expect(decided.events).toMatchObject([{ kind: 'approved', actor_channel: 'client', actor_name: DECIDED_AS }]);
    const after = await readHomeView(link, null);
    if (after.tab !== 'execution') throw new Error('the home left Execution');
    expect(after.home.execution.openVariationCount).toBe(0);
    expect(await projectRows(pair.projectId)).toEqual([{ ...inDesign, state: 'execution' }]);
  });
});
