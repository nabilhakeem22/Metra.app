import { afterAll, describe, expect, it } from 'vitest';
import { closeFixture, raw } from './fixture';

// Round C, PR-C7: the apply-rls side of the 0058 step (AC 41). Every function
// the LIVE app calls keeps its exact arguments and result; the five new ones
// exist once each, are locked down, and read no cost column.

afterAll(async () => {
  await closeFixture();
});

/** Every delivery-portal function the deployed app (main after Wave 1) calls, as 0057 left it. */
const LIVE_SIGNATURES = [
  ['app_concept_option_positions', 'p_engagement_id uuid', 'TABLE(artifact_id uuid, option_position integer)'],
  ['app_delivery_act_notified_by_token', 'p_hash text, p_body_key text, p_milestone_kind text', 'boolean'],
  ['app_delivery_by_token', 'p_hash text', 'jsonb'],
  ['app_delivery_choose_concept_by_token', 'p_hash text, p_artifact_id uuid, p_position integer, p_note text, p_name text, p_ip text, p_ua text', 'text'],
  ['app_delivery_claim_payment_by_token', 'p_hash text, p_milestone_kind text, p_note text, p_name text, p_ip text, p_ua text', 'text'],
  ['app_delivery_comment_by_token', 'p_hash text, p_document_id uuid, p_body text, p_name text, p_ip text, p_ua text', 'text'],
  ['app_delivery_document_by_token', 'p_hash text, p_document_id uuid', 'jsonb'],
  ['app_delivery_document_comments_by_token', 'p_hash text, p_document_id uuid', 'jsonb'],
  ['app_delivery_notify_studio_by_token', 'p_hash text, p_body_key text, p_params jsonb, p_roles jsonb', 'jsonb'],
  ['app_delivery_respond_by_token', 'p_hash text, p_action text, p_note text, p_name text, p_ip text, p_ua text', 'text'],
  ['app_document_access', 'p_kind engagement_artifact_kind, p_settled boolean, p_original_name text', 'text'],
];

const NEW_SIGNATURES = [
  ['app_client_act_anchor', 'p_engagement_id uuid, p_org_id uuid, p_body_key text, p_milestone_kind text', 'timestamp with time zone'],
  ['app_delivery_close_target_by_token', 'p_hash text', 'jsonb'],
  ['app_delivery_logo_by_token', 'p_hash text', 'jsonb'],
  ['app_document_media', 'p_original_name text', 'text'],
  ['app_notify_lost_client_acts', 'p_since timestamp with time zone, p_until timestamp with time zone, p_roles jsonb', 'jsonb'],
];

const NEW_REGPROCEDURES = [
  'public.app_document_media(text)',
  'public.app_delivery_logo_by_token(text)',
  'public.app_delivery_close_target_by_token(text)',
  'public.app_notify_lost_client_acts(timestamptz, timestamptz, jsonb)',
  'public.app_client_act_anchor(uuid, uuid, text, text)',
];

async function signaturesOf(names: string[]): Promise<string[][]> {
  const rows = await raw.query<{ proname: string; args: string; result: string }>(
    `select p.proname, pg_get_function_identity_arguments(p.oid) as args,
            pg_get_function_result(p.oid) as result
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in (${names.map((name) => `'${name}'`).join(', ')})
      order by 1, 2`,
  );
  return rows.map((row) => [row.proname, row.args, row.result]);
}

describe('signatures (AC 41)', () => {
  it('keeps every live delivery function exactly as 0057 left it, one overload each', async () => {
    expect(await signaturesOf(LIVE_SIGNATURES.map(([name]) => name))).toEqual(LIVE_SIGNATURES);
  });

  it('creates each of the five new signatures exactly once', async () => {
    expect(await signaturesOf(NEW_SIGNATURES.map(([name]) => name))).toEqual(NEW_SIGNATURES);
  });
});

describe('privileges (AC 41)', () => {
  it('metra_app may run four of them and NOT the anchor; PUBLIC and the API roles none', async () => {
    const roles = (await raw.query<{ rolname: string }>(
      `select rolname from pg_roles where rolname in ('anon', 'authenticated', 'service_role')`,
    )).map((row) => row.rolname);
    for (const signature of NEW_REGPROCEDURES) {
      const [row] = await raw.query<{ metra_app: boolean; public_grants: number }>(
        `select has_function_privilege('metra_app', '${signature}', 'execute') as metra_app,
                (select count(*)::int from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0) as public_grants
           from pg_proc p where p.oid = '${signature}'::regprocedure`,
      );
      expect(row, signature).toEqual({
        metra_app: !signature.includes('app_client_act_anchor'),
        public_grants: 0,
      });
      // CI's plain Postgres has no Supabase API roles; the production-shaped
      // rehearsal creates them with Supabase's default EXECUTE and checks them.
      for (const role of roles) {
        const [api] = await raw.query<{ allowed: boolean }>(
          `select has_function_privilege('${role}', '${signature}', 'execute') as allowed`,
        );
        expect(api.allowed, `${role} on ${signature}`).toBe(false);
      }
    }
  });

  it('runs the token and sweep functions as SECURITY DEFINER with an empty search_path', async () => {
    const rows = await raw.query<{ proname: string; definer: boolean; config: string[] }>(
      `select proname, prosecdef as definer, proconfig as config from pg_proc
        where proname in ('app_delivery_logo_by_token', 'app_delivery_close_target_by_token',
                          'app_notify_lost_client_acts', 'app_client_act_anchor', 'app_document_media')
        order by proname`,
    );
    expect(rows.map((row) => [row.proname, row.definer, row.config])).toEqual([
      ['app_client_act_anchor', false, ['search_path=""']],
      ['app_delivery_close_target_by_token', true, ['search_path=""']],
      ['app_delivery_logo_by_token', true, ['search_path=""']],
      ['app_document_media', false, ['search_path=""']],
      ['app_notify_lost_client_acts', true, ['search_path=""']],
    ]);
  });

  it('reads no cost, margin or build-cost column in any new or changed function', async () => {
    const rows = await raw.query<{ proname: string; source: string }>(
      `select proname, prosrc as source from pg_proc
        where proname in ('app_delivery_by_token', 'app_delivery_document_by_token',
                          'app_delivery_act_notified_by_token', 'app_document_media',
                          'app_delivery_logo_by_token', 'app_delivery_close_target_by_token',
                          'app_client_act_anchor', 'app_notify_lost_client_acts')`,
    );
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.source, row.proname).not.toMatch(/unit_cost|line_cost|total_cost|margin|build_cost|supervision/i);
    }
  });

  it('grants metra_app UPDATE on exactly 19 design_engagements columns, the three new ones included', async () => {
    const rows = await raw.query<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'design_engagements'
          and grantee = 'metra_app' and privilege_type = 'UPDATE'
        order by column_name`,
    );
    const columns = rows.map((row) => row.column_name);
    expect(columns).toHaveLength(19);
    expect(columns).toEqual(
      expect.arrayContaining(['client_expected_on', 'client_expected_state', 'client_expected_set_at']),
    );
  });
});
