import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H6.3 fix round: which /c links ask for the home, through the REAL token
// functions. S1: only a BOQ contract issued and inside its signing window, so a
// signed, terminated or lapsed contract's old link never reaches a home the
// studio has since replaced or revoked. F1: only the contract the home shows
// now, so a link never lands on a newer contract than its own. Every token
// function is counted at lib/share/sdf-call (the real one, spied).

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
import { getContractByToken } from '@/lib/contracts/public';
import type { OrgContext } from '@/lib/db/context';
import { clientHomeAnswer } from '@/lib/client-home/home-link';
import { revokeDeliveryLinkCore, rotateDeliveryLinkCore } from '@/lib/engagements/share';
import { mintShareToken } from '@/lib/share/token';
import { homePathOf, mintHomeLink, redirectOf } from './client-home-c-link-fixture';
import { seedHome, type Home } from './client-home-fixture';
import { seedProposalContract } from './contract-from-boq-fixture';
import { seedBillableContract } from './execution-billing-fixture';
import { closeExecutionFixture, ownerQuery, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
let owner: OrgContext;

beforeAll(async () => {
  process.env.SHARE_LINK_SECRET = 'h63-share-link-secret-0123456789abcdef0123456789';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const seeded = await seedOrg({ owners: 1 });
  owner = ctxFor(seeded.orgId, seeded.ownerIds[0], 'owner');
  orgIds.push(seeded.orgId);
});

beforeEach(() => {
  sdfCalls.names.length = 0;
});

afterAll(async () => {
  vi.restoreAllMocks();
  delete process.env.SHARE_LINK_SECRET;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const setContractStatus = (home: Home, status: string) =>
  ownerQuery(`update public.contracts set status = $2 where id = $1`, [home.contract.contractId, status]);

/** A home with its contract's link leading to it, the raw /c token and the home link in hand. */
async function liveHome() {
  const home = await seedHome(owner.orgId, 'issued');
  const cRaw = home.contract.rawToken as string;
  const homeRaw = await mintHomeLink(owner, home);
  expect(await redirectOf(cRaw, 'en')).toBe(homePathOf('en', homeRaw));
  sdfCalls.names.length = 0;
  return { home, cRaw, homeRaw };
}

/** Null, after reading the contract and nothing else: this link never asked for a home. */
async function expectNeverAsks(cRaw: string) {
  sdfCalls.names.length = 0;
  expect(await redirectOf(cRaw, 'en')).toBeNull();
  expect(sdfCalls.names).toEqual(['app_contract_by_token']);
}

describe('S1: only a contract awaiting its signature, in its window, asks for the home', () => {
  it('signed: its own document, not the home, also after the home link is replaced', async () => {
    const { home, cRaw } = await liveHome();
    await setContractStatus(home, 'signed');
    await expectNeverAsks(cRaw);
    expect((await rotateDeliveryLinkCore(owner, home.delivery.id)).ok).toBe(true);
    await expectNeverAsks(cRaw);
    expect((await getContractByToken(cRaw))?.status).toBe('signed');
  });

  it('terminated: the invalid page, as on main', async () => {
    const { home, cRaw } = await liveHome();
    await setContractStatus(home, 'terminated');
    await expectNeverAsks(cRaw);
    expect(await getContractByToken(cRaw)).toBeNull();
  });

  it('the signing window has closed: its own document', async () => {
    const { home, cRaw } = await liveHome();
    await tamper(`update public.contracts set share_expires_at = now() - interval '1 second' where id = $1`, [home.contract.contractId]);
    await expectNeverAsks(cRaw);
    expect(await getContractByToken(cRaw)).not.toBeNull();
  });

  it('revoked, then the Client page control mints a new link: a signed link does not come back to life', async () => {
    const { home, cRaw } = await liveHome();
    await setContractStatus(home, 'signed');
    expect((await revokeDeliveryLinkCore(owner, home.delivery.id)).ok).toBe(true);
    expect((await clientHomeAnswer(owner, home.contract.contractId, 'https://studio.example')).ok).toBe(true);
    await expectNeverAsks(cRaw);
  });

  it('an unknown token and a proposal contract read as on main', async () => {
    await expectNeverAsks(mintShareToken().raw);
    const proposalToken = mintShareToken();
    await ownerQuery(`update public.contracts set status = 'issued', token_hash = $2 where id = $1`, [await seedProposalContract(owner.orgId), proposalToken.hash]);
    await expectNeverAsks(proposalToken.raw);
  });

  it('a blank token reads nothing', async () => {
    for (const blank of ['', '   ']) expect(await redirectOf(blank, 'en')).toBeNull();
    expect(sdfCalls.names).toEqual([]);
  });
});

describe("F1: only the contract the home shows now leads there", () => {
  it('a newer issued contract on the delivery: the older one stays on its own document', async () => {
    const { home, cRaw } = await liveHome();
    const newer = await seedBillableContract(owner.orgId, 'issued', home.delivery);
    expect(await redirectOf(cRaw, 'en')).toBeNull();
    expect(sdfCalls.names).toEqual(['app_contract_by_token', 'app_client_home_target_by_token', 'app_home_contract_sections_by_token']);
    const newerPath = await redirectOf(newer.rawToken as string, 'en');
    expect(newerPath).toMatch(/^\/en\/d\/.+\?tab=execution&focus=contract$/);
  });

  it('a newer draft contract on the delivery: the issued one is hidden from the home, so it stays on its own document too', async () => {
    const { home, cRaw } = await liveHome();
    await seedBillableContract(owner.orgId, 'draft', home.delivery);
    expect(await redirectOf(cRaw, 'en')).toBeNull();
  });
});
