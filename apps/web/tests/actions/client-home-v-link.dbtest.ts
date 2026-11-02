import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H7.2 end to end (AC15, AC16, AC19): an old /v link of a BOQ contract's change
// order awaiting the client's decision sends its holder to the client home's
// Execution tab, through the REAL token functions and the real re-derive. Any
// other link renders its own document: decided, lapsed, a terminated contract, a
// proposal contract, an order the home does not list. /v's own decision:
// client-home-v-moved.dbtest.ts. Every token function is counted at lib/share/sdf-call (the real one, spied).

const sdfCalls = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/share/sdf-call')>();
  const nameOf = (query: unknown) => /public\.(app_[a-z0-9_]+)/.exec(JSON.stringify((query as { queryChunks: unknown[] }).queryChunks[0]))?.[1] ?? '?';
  return {
    ...original,
    readSdfJson: (query: unknown, options?: unknown) => {
      sdfCalls.names.push(nameOf(query));
      return original.readSdfJson(query as never, options as never);
    },
  };
});

import type { Locale } from '@/i18n/routing';
import { contractHomeRedirect } from '@/lib/client-home/redirect';
import { variationLinkLanding } from '@/lib/client-home/redirect-variation';
import { getContractByToken } from '@/lib/contracts/public';
import { terminateContractCore } from '@/lib/contracts/lifecycle/terminate';
import type { OrgContext } from '@/lib/db/context';
import { revokeDeliveryLinkCore, rotateDeliveryLinkCore } from '@/lib/engagements/share';
import { mintShareToken } from '@/lib/share/token';
import { getVariationByToken } from '@/lib/variations/public';
import { homePathOf as contractPathOf, mintHomeLink } from './client-home-c-link-fixture';
import { seedHome, seedLightHome, type Home } from './client-home-fixture';
import { seedProposalContract } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract, seedVariation, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const SECRET = 'h7-share-link-secret-0123456789abcdef0123456789ab';
const orgIds: string[] = [];
let printed = '';
let owner: OrgContext;

beforeAll(async () => {
  for (const method of ['log', 'warn', 'error', 'info'] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void (printed += JSON.stringify(args)));
  }
  const seeded = await seedOrg({ owners: 1 });
  owner = ctxFor(seeded.orgId, seeded.ownerIds[0], 'owner');
  orgIds.push(seeded.orgId);
});

beforeEach(() => {
  process.env.SHARE_LINK_SECRET = SECRET;
  sdfCalls.names.length = 0;
});

afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env.SHARE_LINK_SECRET;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const pathOf = (locale: string, homeRaw: string, orderId: string) => `/${locale}/d/${homeRaw}?tab=execution&focus=variation:${orderId}`;

/** The /v page's gate, as it reads: the link's order, then where it leads. */
const landingOf = async (raw: string, locale: Locale = 'en') => variationLinkLanding(raw, await getVariationByToken(raw), locale);
const redirectOf = async (raw: string, locale: Locale = 'en') => (await landingOf(raw, locale)).homePath;

async function orderOf(contract: Home['contract'], status: 'issued' | 'approved' | 'rejected' = 'issued') {
  const link = mintShareToken();
  const order = await seedVariation(owner.orgId, contract, status, { tokenHash: link.hash });
  return { id: order.id, raw: link.raw };
}

/** A home with its client link minted, and one open order. */
async function liveHome(home?: Home) {
  const seeded = home ?? (await seedHome(owner.orgId, 'signed'));
  const homeRaw = await mintHomeLink(owner, seeded);
  return { home: seeded, homeRaw, order: await orderOf(seeded.contract) };
}

/** Null, after reading the order and nothing else: this link never asked for a home. */
async function expectNeverAsked(raw: string) {
  sdfCalls.names.length = 0;
  expect(await redirectOf(raw)).toBeNull();
  expect(sdfCalls.names).toEqual(['app_variation_by_token']);
}

describe('an open order of a home that shows it (AC15)', () => {
  it('leads to the home, on the order, in the asked locale; three reads: the order, the target, the home the page goes by', async () => {
    const { homeRaw, order } = await liveHome();
    expect(await redirectOf(order.raw, 'ar-EG')).toBe(pathOf('ar-EG', homeRaw, order.id));
    sdfCalls.names.length = 0;
    expect(await redirectOf(order.raw)).toBe(pathOf('en', homeRaw, order.id));
    expect(sdfCalls.names).toEqual(['app_variation_by_token', 'app_client_home_target_by_token', 'app_home_by_token']);
  });

  it('a light delivery too', async () => {
    const { homeRaw, order } = await liveHome(await seedLightHome(owner.orgId, 'signed'));
    expect(await redirectOf(order.raw)).toBe(pathOf('en', homeRaw, order.id));
  });

  it('after the studio replaces the link: the NEW one', async () => {
    const { home, homeRaw, order } = await liveHome();
    const rotated = await rotateDeliveryLinkCore(owner, home.delivery.id);
    const newRaw = rotated.data as string;
    const answer = await redirectOf(order.raw);
    expect(answer).toBe(pathOf('en', newRaw, order.id));
    expect(answer).not.toContain(homeRaw);
  });

  it("a contract's link still gives its own answer", async () => {
    const home = await seedHome(owner.orgId, 'issued');
    const homeRaw = await mintHomeLink(owner, home);
    const raw = home.contract.rawToken as string;
    expect(await contractHomeRedirect(raw, await getContractByToken(raw), 'en')).toBe(contractPathOf('en', homeRaw));
  });
});

describe('every other link shows its own document (AC16, with the H6.3 lessons)', () => {
  it.each(['approved', 'rejected'] as const)('a %s order never asks', async (status) => {
    const { home } = await liveHome();
    await expectNeverAsked((await orderOf(home.contract, status)).raw);
  });

  it('an order past its window never asks; nor one of a terminated contract', async () => {
    const { home, order } = await liveHome();
    await tamper(`update public.variation_orders set share_expires_at = now() - interval '1 second' where id = $1`, [order.id]);
    await expectNeverAsked(order.raw);
    const other = await orderOf(home.contract);
    expect((await terminateContractCore(owner, { id: home.contract.contractId })).ok).toBe(true);
    await expectNeverAsked(other.raw);
  });

  it('a proposal contract order, and an unknown link, never ask', async () => {
    const contractId = await seedProposalContract(owner.orgId);
    await ownerQuery(`update public.contracts set status = 'issued' where id = $1`, [contractId]);
    const [project] = await ownerQuery<{ project_id: string }>(`select project_id from public.contracts where id = $1`, [contractId]);
    const link = mintShareToken();
    await seedVariation(owner.orgId, { contractId, projectId: project.project_id }, 'issued', { tokenHash: link.hash });
    await expectNeverAsked(link.raw);
    await expectNeverAsked(mintShareToken().raw);
  });

  it('a blank token reads nothing', async () => {
    expect(await redirectOf('   ')).toBeNull();
    expect(sdfCalls.names).toEqual([]);
  });

  it('a revoked or lapsed home, or none: null after the target; printing nothing', async () => {
    const { home, order } = await liveHome();
    expect((await revokeDeliveryLinkCore(owner, home.delivery.id)).ok).toBe(true);
    sdfCalls.names.length = 0;
    expect(await redirectOf(order.raw)).toBeNull();
    expect(sdfCalls.names).toEqual(['app_variation_by_token', 'app_client_home_target_by_token']);
    const lapsed = await liveHome();
    await tamper(`update public.design_engagements set share_expires_at = now() - interval '1 second' where id = $1`, [lapsed.home.delivery.id]);
    expect(await redirectOf(lapsed.order.raw)).toBeNull();
    expect(printed).not.toContain(order.raw);
  });

  it('a link this server cannot re-derive: a null nonce, an unset secret, a hash that does not match', async () => {
    const { home, order } = await liveHome();
    delete process.env.SHARE_LINK_SECRET;
    expect(await redirectOf(order.raw)).toBeNull();
    process.env.SHARE_LINK_SECRET = SECRET;
    await ownerQuery(`update public.design_engagements set token_hash = $2 where id = $1`, [home.delivery.id, 'f'.repeat(64)]);
    expect(await redirectOf(order.raw)).toBeNull();
    await ownerQuery(`update public.design_engagements set token_nonce = null where id = $1`, [home.delivery.id]);
    expect(await redirectOf(order.raw)).toBeNull();
  });

  it('an order on a contract awaiting its signature stays on /v and says it waits for the signature: the home page lists none until it is signed', async () => {
    const { home, order, homeRaw } = await liveHome(await seedHome(owner.orgId, 'issued'));
    expect(await landingOf(order.raw)).toEqual({ homePath: null, waitsForSignature: true });
    await ownerQuery(`update public.contracts set status = 'signed' where id = $1`, [home.contract.contractId]);
    expect(await landingOf(order.raw)).toEqual({ homePath: pathOf('en', homeRaw, order.id), waitsForSignature: false });
  });

  it('an order of an older contract stays on /v: the home stands on the newer one', async () => {
    const { home, order, homeRaw } = await liveHome();
    expect(await redirectOf(order.raw)).toBe(pathOf('en', homeRaw, order.id));
    await ownerQuery(`update public.boqs set status = 'superseded' where id = $1`, [home.contract.boqId]);
    const newer = await seedExecutionContract(owner.orgId, { state: 'signed', delivery: home.delivery });
    expect(await redirectOf(order.raw)).toBeNull();
    const onTheNewer = await orderOf(newer as unknown as Home['contract']);
    expect(await redirectOf(onTheNewer.raw)).toBe(pathOf('en', homeRaw, onTheNewer.id));
  });

  it('an order past the newest 10 the home lists stays on /v, until the list reaches it', async () => {
    const { home, homeRaw, order } = await liveHome();
    await tamper(`update public.variation_orders set created_at = now() - interval '1 day' where id = $1`, [order.id]);
    const newer = [];
    for (let i = 0; i < 10; i += 1) newer.push(await orderOf(home.contract));
    expect(await redirectOf(order.raw)).toBeNull();
    expect(await redirectOf(newer[0].raw)).toBe(pathOf('en', homeRaw, newer[0].id));
    await ownerQuery(`update public.variation_orders set status = 'approved' where id = $1`, [newer[0].id]);
    expect(await redirectOf(order.raw)).toBe(pathOf('en', homeRaw, order.id));
  });
});
