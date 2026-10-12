import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, stampRenders } from './round-b-fixture';
import { issuancesOf, issueBand, respondSeen } from './round-d-db-fixture';

// Round D, PR-D2: the two consent guards are independent (AC G8), the verbs
// without a guard answer the same whatever instant they carry (Round E, D3),
// and the write is locked down (L2; Round E, D2). The six-argument function
// is dropped by 0060 (delivery-db-step-0060-drop.dbtest.ts).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const SEVEN = 'public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)';

/** A delivery at final_approval with a render round and a band, both issued an hour ago. */
async function reviewed(suffix: string) {
  const d = await seedRoundBDelivery(orgIds, suffix);
  await forceState(d.engagementId, 'final_approval');
  await stampRenders(d.engagementId, `now() - interval '1 hour'`);
  await issueBand(d.engagementId, 100000, 200000, `now() - interval '1 hour'`);
  return d;
}

describe('G8: the design guard reads only the round, the budget guard only the band', () => {
  it('with both re-stamped, each verb answers ok on its own current instant', async () => {
    const d = await reviewed('g8-both');
    await stampRenders(d.engagementId, 'now()');
    await issueBand(d.engagementId, 120000, 220000);
    const now = await issuancesOf(d.hash);
    expect(await respondSeen(d.hash, 'approve_design', now.rom)).toBe('wrong_state');
    expect(await respondSeen(d.hash, 'acknowledge_rom', now.renders)).toBe('wrong_state');
    expect(await respondSeen(d.hash, 'approve_design', now.renders)).toBe('ok');
    expect(await respondSeen(d.hash, 'acknowledge_rom', now.rom)).toBe('ok');
  });

  it('a re-issued band does not stop the design; a re-stamped round does not stop the budget', async () => {
    const band = await reviewed('g8-band');
    const bandSeen = await issuancesOf(band.hash);
    await issueBand(band.engagementId, 120000, 220000);
    expect(await respondSeen(band.hash, 'acknowledge_rom', bandSeen.rom)).toBe('wrong_state');
    expect(await respondSeen(band.hash, 'approve_design', bandSeen.renders)).toBe('ok');

    const round = await reviewed('g8-round');
    const roundSeen = await issuancesOf(round.hash);
    await stampRenders(round.engagementId, 'now()');
    expect(await respondSeen(round.hash, 'approve_design', roundSeen.renders)).toBe('wrong_state');
    expect(await respondSeen(round.hash, 'acknowledge_rom', roundSeen.rom)).toBe('ok');
  });
});

describe('D3: the verbs without a guard ignore the instant they carry', () => {
  // The instant the page showed, one no issuance ever had, then none: the
  // answers are the verb's own at that state, never a guard's `wrong_state`.
  const UNGUARDED: Array<[string, string, [string, string, string]]> = [
    ['approve_concept', 'concept_review', ['ok', 'already', 'already']],
    ['request_concept_changes', 'concept_review', ['ok', 'already', 'already']],
    ['acknowledge_handoff', 'design_only_handoff', ['ok', 'already', 'already']],
    ['approve_concept', 'final_approval', ['wrong_state', 'wrong_state', 'wrong_state']],
    ['acknowledge_handoff', 'closed_design_only', ['not_active', 'not_active', 'not_active']],
  ];
  for (const [action, state, codes] of UNGUARDED) {
    it(`${action} at ${state}: ${codes.join(', ')}`, async () => {
      const d = await reviewed(`d3-${action}-${state}`);
      await forceState(d.engagementId, state);
      const { rom } = await issuancesOf(d.hash);
      expect([
        await respondSeen(d.hash, action, rom),
        await respondSeen(d.hash, action, '1999-12-31T23:59:59.999999Z'),
        await respondSeen(d.hash, action, null),
      ]).toEqual(codes);
    });
  }
});

describe('L2, D2: the write is locked down', () => {
  it('metra_app may run it; PUBLIC holds no entry; the API roles may not', async () => {
    const [row] = await raw.query<{ metra_app: boolean; public_grants: number; definer: boolean; config: string[] }>(
      `select has_function_privilege('metra_app', '${SEVEN}', 'execute') as metra_app,
              (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0) as public_grants,
              p.prosecdef as definer, p.proconfig as config
         from pg_proc p where p.oid = '${SEVEN}'::regprocedure`,
    );
    expect({ ...row, config: [...row.config].sort() }).toEqual({
      metra_app: true,
      public_grants: 0,
      definer: true,
      config: ['lock_timeout=4s', 'search_path=""'],
    });
    const roles = await raw.query<{ rolname: string }>(
      `select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')`,
    );
    for (const { rolname } of roles) {
      const [api] = await raw.query<{ allowed: boolean }>(
        `select has_function_privilege('${rolname}', '${SEVEN}', 'execute') as allowed`,
      );
      expect(api.allowed, rolname).toBe(false);
    }
  });
});
