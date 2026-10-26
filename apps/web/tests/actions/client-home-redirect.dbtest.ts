import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashShareToken, mintShareToken } from '@/lib/share/token';
import { seedHome, seedLightHome } from './client-home-fixture';
import { seedProposalContract } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery, seedVariation, tamper } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Client home DB step C: where an old contract link (/c) or change-order link
// (/v) sends its holder (app_client_home_target_by_token, the redirect plan):
// the home that owns the document, with the home's hash and nonce for the
// server to re-derive the link from, or the SAME null for everything else, so
// the answer tells a stranger nothing (AC29, AC30 at the SQL level).

const orgIds: string[] = [];
let orgId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  orgIds.push(orgId);
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

interface Target {
  engagement_id: string;
  token_hash: string;
  token_nonce: string | null;
  focus_id: string;
}

const targetOf = async (kind: string, hash: string | null): Promise<Target | null> =>
  (await ownerQuery<{ target: Target | null }>(`select public.app_client_home_target_by_token($1, $2) as target`, [kind, hash]))[0].target;

const contractHashOf = async (contractId: string): Promise<string> =>
  (await ownerQuery<{ token_hash: string }>(`select token_hash from public.contracts where id = $1`, [contractId]))[0].token_hash;

describe('a BOQ contract link points at its live home', () => {
  it('answers the home\'s id, hash, nonce and the contract to focus, for issued, signed and terminated', async () => {
    const home = await seedHome(orgId, 'issued');
    await ownerQuery(`update public.design_engagements set token_nonce = 'nonce-1' where id = $1`, [home.delivery.id]);
    const hash = await contractHashOf(home.contract.contractId);
    const expected = { engagement_id: home.delivery.id, token_hash: home.delivery.tokenHash, token_nonce: 'nonce-1', focus_id: home.contract.contractId };
    expect(await targetOf('contract', hash)).toEqual(expected);
    await ownerQuery(`update public.contracts set status = 'signed' where id = $1`, [home.contract.contractId]);
    expect(await targetOf('contract', hash)).toEqual(expected);
    await ownerQuery(`update public.contracts set status = 'terminated' where id = $1`, [home.contract.contractId]);
    expect(await targetOf('contract', hash)).toEqual(expected);
  });

  it('follows a rotated home link to the NEW hash', async () => {
    const home = await seedHome(orgId, 'signed');
    const hash = await contractHashOf(home.contract.contractId);
    const rotated = mintShareToken();
    await ownerQuery(`update public.design_engagements set token_hash = $2, token_nonce = 'nonce-2' where id = $1`, [home.delivery.id, rotated.hash]);
    expect(await targetOf('contract', hash)).toMatchObject({ token_hash: rotated.hash, token_nonce: 'nonce-2' });
  });

  it('finds a light delivery by the contract\'s project', async () => {
    const light = await seedLightHome(orgId, 'issued');
    const hash = await contractHashOf(light.contract.contractId);
    expect(await targetOf('contract', hash)).toMatchObject({ engagement_id: light.delivery.id, focus_id: light.contract.contractId });
  });

  it('answers a change order link with its home and the change order to focus; an inert one is null', async () => {
    const home = await seedHome(orgId, 'signed');
    const raw = randomUUID();
    const issued = await seedVariation(orgId, home.contract, 'issued', { tokenHash: hashShareToken(raw) });
    expect(await targetOf('variation', hashShareToken(raw))).toMatchObject({ engagement_id: home.delivery.id, focus_id: issued.id });
    const inertRaw = randomUUID();
    await seedVariation(orgId, home.contract, 'internal_approved', { tokenHash: hashShareToken(inertRaw) });
    expect(await targetOf('variation', hashShareToken(inertRaw))).toBeNull();
    expect(await targetOf('contract', hashShareToken(raw))).toBeNull();
  });
});

describe('everything else is the same null: no oracle (AC30)', () => {
  it('an unknown token, a proposal contract, a revoked, expired or not-yet-execution home, a draft and an unknown kind', async () => {
    expect(await targetOf('contract', 'f'.repeat(64))).toBeNull();
    expect(await targetOf('contract', null)).toBeNull();

    const proposalContractId = await seedProposalContract(orgId);
    const proposalToken = mintShareToken();
    await ownerQuery(`update public.contracts set status = 'issued', token_hash = $2 where id = $1`, [proposalContractId, proposalToken.hash]);
    expect(await targetOf('contract', proposalToken.hash)).toBeNull();

    const revoked = await seedHome(orgId, 'issued');
    await ownerQuery(`update public.design_engagements set token_hash = null where id = $1`, [revoked.delivery.id]);
    expect(await targetOf('contract', await contractHashOf(revoked.contract.contractId))).toBeNull();

    const expired = await seedHome(orgId, 'issued');
    await tamper(`update public.design_engagements set share_expires_at = now() - interval '1 second' where id = $1`, [expired.delivery.id]);
    expect(await targetOf('contract', await contractHashOf(expired.contract.contractId))).toBeNull();

    const designing = await seedHome(orgId, 'issued');
    await tamper(`update public.design_engagements set state = 'boq' where id = $1`, [designing.delivery.id]);
    expect(await targetOf('contract', await contractHashOf(designing.contract.contractId))).toBeNull();

    const draftToken = mintShareToken();
    const draft = await seedHome(orgId, 'draft');
    await tamper(`update public.contracts set token_hash = $2 where id = $1`, [draft.contract.contractId, draftToken.hash]);
    expect(await targetOf('contract', draftToken.hash)).toBeNull();

    const live = await seedHome(orgId, 'issued');
    expect(await targetOf('delivery', await contractHashOf(live.contract.contractId))).toBeNull();
  });
});
