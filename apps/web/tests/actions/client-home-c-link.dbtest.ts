import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H6.3 end to end (AC1 to AC3, AC10): an old contract link (/c) of a BOQ
// contract sends its holder to the client home's Execution tab, through the
// REAL token function and the real re-derive; every other link renders /c as
// before, after exactly one read. Every token function is counted at
// lib/share/sdf-call (the real one, spied), and nothing printed names a token
// or a hash. What a whole /c request reads: client-home-c-reads.dbtest.ts.

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
import { contractHomeRedirect } from '@/lib/client-home/redirect';
import type { OrgContext } from '@/lib/db/context';
import { revokeDeliveryLinkCore, rotateDeliveryLinkCore } from '@/lib/engagements/share';
import { hashShareToken, mintShareToken } from '@/lib/share/token';
import { homePathOf as pathOf, mintHomeLink } from './client-home-c-link-fixture';
import { seedHome, seedLightHome, type Home } from './client-home-fixture';
import { seedProposalContract } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery, tamper } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const SECRET = 'h63-share-link-secret-0123456789abcdef0123456789';
const orgIds: string[] = [];
const secrets: string[] = [];
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
  // AC10: no raw token and no hash of a /c link or a home link was printed.
  for (const secret of secrets) expect(printed).not.toContain(secret);
  vi.restoreAllMocks();
  delete process.env.SHARE_LINK_SECRET;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** The contract's /c raw token, kept for the AC10 check with its hash. */
function contractRawOf(home: Home): string {
  const raw = home.contract.rawToken as string;
  secrets.push(raw, hashShareToken(raw));
  return raw;
}

/** The home's link as the studio first shares it (re-derivable), its raw kept for AC10. */
async function minted(home: Home): Promise<string> {
  const raw = await mintHomeLink(owner, home);
  secrets.push(raw, hashShareToken(raw));
  return raw;
}

describe('a BOQ contract link leads to its home (AC1, AC2)', () => {
  it('issued, signed and terminated, in both locales', async () => {
    const home = await seedHome(owner.orgId, 'issued');
    const cRaw = contractRawOf(home);
    const homeRaw = await minted(home);
    expect(await contractHomeRedirect(cRaw, 'ar-EG')).toBe(pathOf('ar-EG', homeRaw));
    expect(await contractHomeRedirect(cRaw, 'en')).toBe(pathOf('en', homeRaw));
    for (const status of ['signed', 'terminated']) {
      await ownerQuery(`update public.contracts set status = $2 where id = $1`, [home.contract.contractId, status]);
      expect(await contractHomeRedirect(cRaw, 'en')).toBe(pathOf('en', homeRaw));
    }
  });

  it('a light delivery', async () => {
    const light = await seedLightHome(owner.orgId, 'issued');
    const homeRaw = await minted(light);
    expect(await contractHomeRedirect(contractRawOf(light), 'ar-EG')).toBe(pathOf('ar-EG', homeRaw));
  });

  it('after the home link is replaced, the NEW link; the old one appears nowhere', async () => {
    const home = await seedHome(owner.orgId, 'issued');
    const cRaw = contractRawOf(home);
    const oldRaw = await minted(home);
    const rotated = await rotateDeliveryLinkCore(owner, home.delivery.id);
    const newRaw = rotated.data as string;
    secrets.push(newRaw);
    const answer = await contractHomeRedirect(cRaw, 'en');
    expect(answer).toBe(pathOf('en', newRaw));
    expect(answer).not.toContain(oldRaw);
  });
});

describe('everything else renders /c as before, after exactly one read (AC3)', () => {
  const expectNull = async (cRaw: string) => {
    sdfCalls.names.length = 0;
    expect(await contractHomeRedirect(cRaw, 'en')).toBeNull();
    expect(sdfCalls.names).toEqual(['app_client_home_target_by_token']);
  };

  it('an unknown token and a proposal contract', async () => {
    await expectNull(mintShareToken().raw);
    const proposalToken = mintShareToken();
    await ownerQuery(`update public.contracts set status = 'issued', token_hash = $2 where id = $1`, [await seedProposalContract(owner.orgId), proposalToken.hash]);
    await expectNull(proposalToken.raw);
  });

  it.each([
    ['a revoked home', async (home: Home) => expect((await revokeDeliveryLinkCore(owner, home.delivery.id)).ok).toBe(true)],
    ['an expired home link', (home: Home) => tamper(`update public.design_engagements set share_expires_at = now() - interval '1 second' where id = $1`, [home.delivery.id])],
    ['a home not at execution', (home: Home) => tamper(`update public.design_engagements set state = 'boq' where id = $1`, [home.delivery.id])],
  ])('%s', async (_case, spoil) => {
    const home = await seedHome(owner.orgId, 'issued');
    await minted(home);
    await spoil(home);
    await expectNull(contractRawOf(home));
  });

  it('no nonce, no secret, or a stored hash the derivation does not match', async () => {
    const home = await seedHome(owner.orgId, 'issued');
    const cRaw = contractRawOf(home);
    await expectNull(cRaw); // seeded with a random link: no nonce
    await minted(home);
    delete process.env.SHARE_LINK_SECRET;
    await expectNull(cRaw);
    process.env.SHARE_LINK_SECRET = SECRET;
    await ownerQuery(`update public.design_engagements set token_nonce = 'another-nonce' where id = $1`, [home.delivery.id]);
    await expectNull(cRaw);
  });

  it('a blank token: no read at all', async () => {
    for (const blank of ['', '   ']) expect(await contractHomeRedirect(blank, 'en')).toBeNull();
    expect(sdfCalls.names).toEqual([]);
  });
});
