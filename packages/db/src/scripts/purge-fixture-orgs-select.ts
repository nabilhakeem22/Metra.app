// Which fixture orgs are doomed, and what counts as a fixture name. Split out of
// purge-fixture-orgs.ts so the DECISION (what may be deleted) is readable and
// reviewable on its own, apart from the delete mechanics.
import type { PostgresJs } from '../client';

export const FIXTURE_NAME = 'Test Org';
/** Younger than this, a test run may still be holding the org. Never touched. */
export const MIN_AGE = '24 hours';
/**
 * A fixture-created name, on the given alias. TWO spellings: the bare marker
 * (debris from before the fixture started timestamping) and `Test Org <ISO>`.
 * The timestamped form must continue with a year, so a real firm would have to
 * be named "Test Org 2..." to match here — and it would still have to fail
 * every exclusion in `selectDoomedOrgs` as well.
 */
function fixtureName(alias: string): string {
  return `(${alias}.name_en = '${FIXTURE_NAME}' or ${alias}.name_en like '${FIXTURE_NAME} 2%')`;
}

export interface DoomedOrg { orgId: string; accountId: string }
/** Pool or transaction: every write path here goes through `unsafe`. */
export type Executor = { unsafe: PostgresJs['unsafe'] };

export async function countRealOrgs(sql: Executor): Promise<number> {
  const rows = (await sql.unsafe(
    `select count(*)::int as n from public.organizations o where not ${fixtureName('o')}`,
  )) as unknown as Array<{ n: number }>;
  return rows[0].n;
}

export async function countFixtureOrgs(sql: Executor): Promise<number> {
  const rows = (await sql.unsafe(
    `select count(*)::int as n from public.organizations o where ${fixtureName('o')}`,
  )) as unknown as Array<{ n: number }>;
  return rows[0].n;
}

/** Fixture orgs passing EVERY exclusion. Excluded orgs are simply absent. */
export async function selectDoomedOrgs(sql: Executor): Promise<DoomedOrg[]> {
  return (await sql.unsafe(
    `select o.id as "orgId", o.account_id as "accountId"
     from public.organizations o
     join public.accounts a on a.id = o.account_id and ${fixtureName('a')}
     where ${fixtureName('o')}
       and o.created_at <= now() - '${MIN_AGE}'::interval
       and not exists (select 1 from public.organizations x
                        where x.account_id = o.account_id and x.id <> o.id)
       and not exists (select 1 from public.memberships m
                        join public.memberships m2 on m2.user_id = m.user_id
                        join public.organizations o2 on o2.id = m2.org_id
                                                    and not ${fixtureName('o2')}
                       where m.org_id = o.id)
       and not exists (select 1 from public.memberships m
                        join auth.users u on u.id = m.user_id
                       where m.org_id = o.id)
     order by o.created_at`,
  )) as unknown as DoomedOrg[];
}
