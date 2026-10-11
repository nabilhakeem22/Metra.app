import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery, stampRenders } from './round-b-fixture';
import { issuancesOf, issueBand, respondLegacy, respondSeen } from './round-d-db-fixture';

// Round D, PR-D2: the two consent guards are independent (AC G8), the
// six-argument function still answers the deployed code (G9; its own cases are
// delivery-respond.dbtest.ts, unchanged), and the overload is locked down (L2).

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const SEVEN = 'public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)';
const SIX = 'public.app_delivery_respond_by_token(text, text, text, text, text, text)';

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

  const UNGUARDED: Array<[string, string]> = [
    ['approve_concept', 'concept_review'],
    ['request_concept_changes', 'concept_review'],
    ['acknowledge_handoff', 'design_only_handoff'],
    ['approve_concept', 'final_approval'],
    ['acknowledge_handoff', 'closed_design_only'],
  ];
  for (const [action, state] of UNGUARDED) {
    it(`${action} at ${state}: the same answers through six and seven arguments, whatever the instant`, async () => {
      const legacy = await reviewed(`g8-6-${action}-${state}`);
      const seven = await reviewed(`g8-7-${action}-${state}`);
      await forceState(legacy.engagementId, state);
      await forceState(seven.engagementId, state);
      const { rom } = await issuancesOf(seven.hash);
      const legacyAnswers = [await respondLegacy(legacy.hash, action), await respondLegacy(legacy.hash, action)];
      const sevenAnswers = [
        await respondSeen(seven.hash, action, rom),
        await respondSeen(seven.hash, action, '1999-12-31T23:59:59.999999Z'),
      ];
      expect(sevenAnswers).toEqual(legacyAnswers);
      expect(await respondSeen(seven.hash, action, null)).toBe(legacyAnswers[1]);
    });
  }
});

describe('G9: the six-argument function is still there for the deployed code', () => {
  it('exists beside the overload, and still writes without an instant', async () => {
    const rows = await raw.query<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'app_delivery_respond_by_token' order by 1`,
    );
    expect(rows.map((row) => row.args)).toEqual([
      'p_hash text, p_action text, p_expected_issue_at timestamp with time zone, p_note text, p_name text, p_ip text, p_ua text',
      'p_hash text, p_action text, p_note text, p_name text, p_ip text, p_ua text',
    ]);
    const d = await reviewed('g9');
    expect(await respondLegacy(d.hash, 'acknowledge_rom')).toBe('ok');
  });
});

describe('L2: the overload is locked down', () => {
  it('metra_app may run it; PUBLIC holds no entry; the API roles may not', async () => {
    const [row] = await raw.query<{ metra_app: boolean; public_grants: number; definer: boolean; config: string[] }>(
      `select has_function_privilege('metra_app', '${SEVEN}', 'execute') as metra_app,
              (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where a.grantee = 0) as public_grants,
              p.prosecdef as definer, p.proconfig as config
         from pg_proc p where p.oid = '${SEVEN}'::regprocedure`,
    );
    expect(row).toEqual({ metra_app: true, public_grants: 0, definer: true, config: ['search_path=""'] });
    const roles = await raw.query<{ rolname: string }>(
      `select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')`,
    );
    for (const { rolname } of roles) {
      for (const signature of [SEVEN, SIX]) {
        const [api] = await raw.query<{ allowed: boolean }>(
          `select has_function_privilege('${rolname}', '${signature}', 'execute') as allowed`,
        );
        expect(api.allowed, `${rolname} on ${signature}`).toBe(false);
      }
    }
  });
});
