import { sqlstateOf } from '@metra/db/sqlstate';
import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw, teardown } from './fixture';
import { forceState, seedRoundBDelivery } from './round-b-fixture';
import { respondSeen } from './round-d-db-fixture';

// Round E (0060), AC D1: the six-argument app_delivery_respond_by_token is
// DROPPED. One respond function is left, the one that takes the issuance the
// client saw; a call in the retired form finds no function (42883), which is
// what a Worker older than Round D Wave 3 would get. Its lockdown is pinned by
// delivery-db-step-0059-functions (L2, D2) and token-sdf-lockdown (D6); the
// SQL text that keeps it gone by packages/db/src/rls/retired-functions.test.ts.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

const SIX = 'public.app_delivery_respond_by_token(text, text, text, text, text, text)';

describe('D1: the six-argument respond write is gone', () => {
  it('does not resolve, and exactly one respond function is left: the seven-argument one', async () => {
    const [gone] = await raw.query<{ resolved: string | null }>(`select to_regprocedure('${SIX}')::text as resolved`);
    expect(gone.resolved).toBeNull();
    const rows = await raw.query<{ args: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'app_delivery_respond_by_token'`,
    );
    expect(rows.map((row) => row.args)).toEqual([
      'p_hash text, p_action text, p_expected_issue_at timestamp with time zone, p_note text, p_name text, p_ip text, p_ua text',
    ]);
  });

  it('a call in the retired form fails with 42883 and writes nothing; the live form still saves', async () => {
    const d = await seedRoundBDelivery(orgIds, 'd1-call');
    await forceState(d.engagementId, 'design_only_handoff');
    const retired = await raw
      .query(`select public.app_delivery_respond_by_token('${d.hash}', 'acknowledge_handoff', null, 'Client Sam', '1.2.3.4', 'probe/1')`)
      .then(() => 'ok', (error: unknown) => sqlstateOf(error) ?? String(error));
    expect(retired).toBe('42883');
    const [none] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.engagement_events where engagement_id = '${d.engagementId}'`,
    );
    expect(none.n).toBe(0);
    expect(await respondSeen(d.hash, 'acknowledge_handoff', null)).toBe('ok');
  });
});
