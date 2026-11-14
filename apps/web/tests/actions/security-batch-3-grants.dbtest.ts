import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appQuery, closeExecutionFixture, ownerQuery, sqlstate } from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Security batch 3, A4 and A5 (migration 0067 and its apply-rls): the three
// grants narrowed in rls/roles.sql as the DATABASE holds them, what metra_app
// is refused and still allowed, the dropped trigger function and the pinned
// search_path. The cores that write these tables keep their own suites.

let orgId: string;
let ownerId: string;
let keyId: string;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  const [key] = await ownerQuery<{ id: string }>(
    `insert into public.api_keys (org_id, label, token_hash, token_prefix, created_by)
     values ($1, 'Grant probe', $2, 'mtk_prob', $3) returning id`,
    [orgId, `probe-${randomUUID()}`, ownerId],
  );
  keyId = key.id;
});

afterAll(async () => {
  await teardown([orgId]);
  await closeExecutionFixture();
  await closeFixture();
});

/** The SQLSTATE a statement is refused with as the studio's owner under metra_app, or null when it ran. */
function asOwner(text: string, params: unknown[] = []): Promise<string | null> {
  return sqlstate(appQuery(orgId, ownerId, text, params));
}

async function updatableColumns(table: string): Promise<string[]> {
  const rows = await ownerQuery<{ name: string }>(
    `select a.attname as name from pg_attribute a
      where a.attrelid = ('public.' || $1)::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('metra_app', a.attrelid, a.attnum, 'update')
      order by 1`,
    [table],
  );
  return rows.map((row) => row.name);
}

describe('what metra_app holds on the three narrowed tables (AC18)', () => {
  it('organizations lose DELETE; api_keys and client_payment_claims lose table-level UPDATE, and the claims INSERT', async () => {
    const rows = await ownerQuery<{ name: string; privileges: string }>(
      `select t.name,
              concat(case when has_table_privilege('metra_app', 'public.' || t.name, 'select') then 'S' end,
                     case when has_table_privilege('metra_app', 'public.' || t.name, 'insert') then 'I' end,
                     case when has_table_privilege('metra_app', 'public.' || t.name, 'update') then 'U' end,
                     case when has_table_privilege('metra_app', 'public.' || t.name, 'delete') then 'D' end,
                     case when has_table_privilege('metra_app', 'public.' || t.name, 'truncate') then 'T' end) as privileges
         from unnest(array['api_keys', 'client_payment_claims', 'organizations']) as t(name) order by 1`,
    );
    expect(rows).toEqual([
      { name: 'api_keys', privileges: 'SI' },
      { name: 'client_payment_claims', privileges: 'S' },
      { name: 'organizations', privileges: 'SIU' },
    ]);
  });

  it('the column UPDATE is exactly the revoke stamp on api_keys and exactly the answer on client_payment_claims', async () => {
    expect(await updatableColumns('api_keys')).toEqual(['revoked_at', 'updated_at']);
    expect(await updatableColumns('client_payment_claims')).toEqual([
      'confirmed_payment_event_id',
      'resolved_at',
      'resolved_by',
      'status',
      'updated_at',
    ]);
  });
});

describe('what metra_app is refused, and still allowed (AC19)', () => {
  it.each([
    ['created_by', `created_by = '${randomUUID()}'`],
    ['token_hash', `token_hash = 'rewritten'`],
    ['org_id', `org_id = '${randomUUID()}'`],
    ['expires_at', `expires_at = null`],
    ['label', `label = 'renamed'`],
    ['last_used_at', `last_used_at = now()`],
  ])('an api_keys update of %s is 42501, and the key is unchanged', async (_column, assignment) => {
    const [before] = await ownerQuery(`select * from public.api_keys where id = $1`, [keyId]);
    expect(await asOwner(`update public.api_keys set ${assignment} where id = $1`, [keyId])).toBe('42501');
    expect(await asOwner(`update public.api_keys set revoked_at = now(), ${assignment} where id = $1`, [keyId])).toBe('42501');
    expect(await ownerQuery(`select * from public.api_keys where id = $1`, [keyId])).toEqual([before]);
  });

  it('an api_keys delete is 42501; a revoke (revoked_at, updated_at) still runs', async () => {
    expect(await asOwner(`delete from public.api_keys where id = $1`, [keyId])).toBe('42501');
    expect(await asOwner(`update public.api_keys set revoked_at = now(), updated_at = now() where id = $1`, [keyId])).toBeNull();
    expect(await ownerQuery(`select revoked_at is not null as revoked from public.api_keys where id = $1`, [keyId])).toEqual([{ revoked: true }]);
  });

  it('a client_payment_claims insert, a rewrite of what the client claimed and a delete are 42501', async () => {
    const claim = [randomUUID()];
    expect(
      await asOwner(
        `insert into public.client_payment_claims (org_id, engagement_id, milestone_kind, claimed_amount) values ($1, $2, 'deposit', 1000)`,
        [orgId, randomUUID()],
      ),
    ).toBe('42501');
    for (const assignment of [`claimed_amount = 1`, `note = 'rewritten'`, `actor_name = 'someone'`, `actor_ip = '10.0.0.1'`, `milestone_kind = 'balance'`]) {
      expect(await asOwner(`update public.client_payment_claims set ${assignment} where id = $1`, claim), assignment).toBe('42501');
    }
    expect(await asOwner(`delete from public.client_payment_claims where id = $1`, claim)).toBe('42501');
  });

  it('the claim answer and its row lock are still allowed (the statements a confirm and a dismiss send)', async () => {
    const claim = [randomUUID()];
    expect(await asOwner(`select id from public.client_payment_claims where id = $1 for update`, claim)).toBeNull();
    expect(
      await asOwner(
        `update public.client_payment_claims
            set status = 'dismissed', confirmed_payment_event_id = null, resolved_by = '${ownerId}', resolved_at = now(), updated_at = now()
          where id = $1`,
        claim,
      ),
    ).toBeNull();
  });

  it('an organizations delete is 42501 and the studio stays; an update still runs', async () => {
    expect(await asOwner(`delete from public.organizations where id = $1`, [orgId])).toBe('42501');
    expect(await asOwner(`update public.organizations set name_en = name_en where id = $1`, [orgId])).toBeNull();
    expect(await ownerQuery(`select id from public.organizations where id = $1`, [orgId])).toHaveLength(1);
  });
});

describe('the dropped trigger function and the pinned search_path (AC20)', () => {
  it('enforce_same_org() is gone, and no function in public is still named so', async () => {
    const [row] = await ownerQuery<{ dropped: boolean; named: number }>(
      `select to_regprocedure('public.enforce_same_org()') is null as dropped,
              (select count(*)::int from pg_proc where proname = 'enforce_same_org') as named`,
    );
    expect(row).toEqual({ dropped: true, named: 0 });
  });

  it('text_has_visible_character has an empty search_path and is still immutable', async () => {
    const [row] = await ownerQuery<{ config: string[]; volatile: string }>(
      `select proconfig as config, provolatile as volatile from pg_proc
        where oid = 'public.text_has_visible_character(text)'::regprocedure`,
    );
    expect(row).toEqual({ config: ['search_path=""'], volatile: 'i' });
  });
});
