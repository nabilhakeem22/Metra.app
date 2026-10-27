// The orphaned-org-row section of `runSchemaCheck`: the one section that reads
// USER ROWS rather than a catalogue, and its printer.
import {
  ORGANIZATIONS_VISIBLE_QUERY,
  orphanOrgRowsQuery,
  orphanReportLines,
  type OrphanOrgRows,
} from './org-orphan-rows';
import { orgScopedTableNames } from './schema-catalogue';
import type { CatalogueSql } from './schema-check';

/**
 * A row count, whatever the driver made of it — or null when the answer is not a
 * count at all. NEVER `Number(x)` on its own (wave 8 F7): `count(*)` is int8, a
 * driver that hands int8 back as a STRING makes a strict `=== 0` guard dead
 * ('0' is not 0), and `Number(null)` is 0, which would turn "the query answered
 * nothing" into "there are no organizations". Both directions are named here so
 * neither can be reached by accident.
 */
function asCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

type OrphanSection =
  /** The read happened. `answered` is how many tables the DATABASE returned. */
  | { kind: 'read'; answered: number; lines: string[] }
  /** The read did not happen, or must not be trusted. Never a row count. */
  | { kind: 'unavailable'; reason: string };

/** Why the visibility guard's answer cannot be trusted, or null when it can. */
function visibleOrganizationsProblem(visible: { rows: unknown } | undefined): string | null {
  if (!visible) return `${ORGANIZATIONS_VISIBLE_QUERY} returned no row at all`;
  const organizations = asCount(visible.rows);
  if (organizations === null) {
    return (
      `${ORGANIZATIONS_VISIBLE_QUERY} answered ${JSON.stringify(visible.rows)}, ` +
      'which is not a count'
    );
  }
  if (organizations === 0) {
    return (
      'this connection reads 0 rows from public.organizations, so every table would ' +
      'report fully orphaned. Fix the privilege or the RLS on this role, then re-run'
    );
  }
  return null;
}

async function orphanOrgRowSection(sql: CatalogueSql): Promise<OrphanSection> {
  const handle = sql as unknown as {
    unsafe: <T>(query: string) => Promise<T>;
  };
  const tables = orgScopedTableNames();
  const [visible] = await handle.unsafe<Array<{ rows: unknown }>>(ORGANIZATIONS_VISIBLE_QUERY);
  const problem = visibleOrganizationsProblem(visible);
  if (problem !== null) return { kind: 'unavailable', reason: problem };
  const counts = await handle.unsafe<OrphanOrgRows[]>(orphanOrgRowsQuery(tables));
  return { kind: 'read', answered: counts.length, lines: orphanReportLines(counts) };
}

/**
 * Rows whose `org_id` names no organization, per org-scoped table. REPORT ONLY.
 *
 * The same question the purge asks as its post-condition, asked here of whatever
 * database the owner is pointing at. It is the one section that reads USER ROWS
 * rather than a catalogue, which is why it is wrapped: an orphan is a data
 * incident to investigate, never a reason for this script to stop printing the
 * four sections it exists for, and a connection that cannot read a table must not
 * take the report down with it.
 */
export async function readOrphanSection(sql: CatalogueSql): Promise<OrphanSection> {
  try {
    return await orphanOrgRowSection(sql);
  } catch (error) {
    return { kind: 'unavailable', reason: (error as Error).message };
  }
}

/**
 * Print the orphan section. Its own printer because "declared / NOT FOUND" is the
 * wrong sentence for it: nothing is declared and nothing is missing — a row is
 * pointing at an organization that is not there.
 *
 * AND A FAILED READ HAS ITS OWN SENTENCE AGAIN (wave 8 F2). The first version
 * funnelled every branch through one printer, so a REJECTED query, an
 * unreadable `organizations` and an empty visibility row each printed
 * "44 org-scoped table(s) read, 1 WITH ORPHANS" followed by the remediation
 * paragraph telling the operator to go and find rows by org_id. It stated a
 * connection problem as a data incident, over a count of tables nothing had
 * read. An unavailable section now says only that it is unavailable, and names
 * no number it does not have.
 *
 * The count on the READ branch is what the DATABASE ANSWERED (F6), not what
 * `src/schema/` declares: a query that returned 40 rows for 44 declared tables
 * must not print 44.
 */
export function reportOrphans(section: OrphanSection): void {
  if (section.kind === 'unavailable') {
    console.log(
      `assert-schema-applied: orphaned org rows — could not be read: ${section.reason}. ` +
        'Nothing is reported about orphaned rows on this run.',
    );
    return;
  }
  if (section.lines.length === 0) {
    console.log(
      `assert-schema-applied: orphaned org rows — ${section.answered} org-scoped table(s) ` +
        'answered, none holds a row whose org_id names no organization.',
    );
    return;
  }
  console.log(
    `assert-schema-applied: orphaned org rows — ${section.answered} org-scoped table(s) ` +
      `answered, ${section.lines.length} WITH ORPHANS (report only, does not fail this ` +
      `check):\n${section.lines.join('\n')}\n` +
      'Every org-scoped table has org_id -> organizations(id) ON DELETE RESTRICT, so ' +
      'this cannot happen in ordinary operation. The one window where it can is ' +
      "`db:purge-fixture-orgs`'s `session_replication_role = 'replica'`, which " +
      'suspends foreign keys along with the immutability triggers. Find the rows by ' +
      'org_id before anything else writes to this database.',
  );
}
