import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { commitImportCore, createBoqCore } from '@/lib/boqs/core';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// WHAT 0052 BOUGHT, asserted against a real Postgres.
//
// Every one of the twelve `on delete set null` composite FKs used to null
// `org_id` as well as the reference, because Postgres's bare `ON DELETE SET
// NULL` nulls EVERY referencing column. `org_id` is `not null` on every
// org-scoped table, so the PARENT DELETE WAS ALWAYS REFUSED - 23502 on an
// ordinary child row, MT100 on one under `enforce_immutable_when` (a BEFORE
// trigger runs before the not-null check and sees org_id change first).
// `boq-immutable.dbtest.ts` measured exactly that, and its last case has been
// rewritten to the post-0052 truth; this file is the positive proof.
//
// 0052 narrows all twelve to `ON DELETE SET NULL (<x>_id)`. ELEVEN are declared
// in `src/schema/`; the twelfth, `files_category_same_org_fk`, exists in the
// database only (0040 created it, `files.ts` never declared it) and was found by
// 0052's own straggler check failing the first CI run. The count assertion at
// the bottom of this file is what keeps that number honest. Two properties are
// asserted here, and NEITHER is visible to `db:assert-snapshot` (snapshot format
// v7 has no field for the column list) or to `assert-schema-applied` (it
// compares `conname` only):
//
//   1. BEHAVIOUR - the parent delete now succeeds, the reference goes null, and
//      `org_id` is UNTOUCHED. That is the whole point: tenancy survives the
//      cascade.
//   2. THE CATALOGUE - `confdelsetcols` names exactly one column and it is not
//      `org_id`. Behaviour alone would pass on a FK someone re-created as
//      `on delete cascade`, which is a different and much worse thing.
//
// AND IT IS THE FIRST REAL TRAFFIC THROUGH BRANCH 2 OF `enforce_immutable_when`
// (the fourth TG_ARGV, `engagement_id,source_file_id`). That branch is fenced to
// `pg_trigger_depth() > 1`, so only a referential action can reach it - and
// until 0052 no such action could complete, which is why wave 6 shipped it with
// zero coverage in the admitting direction. The ISSUED cases below are that
// coverage: the cascade is ADMITTED on a document that is otherwise frozen,
// while a DIRECT null of the same column stays MT100 (asserted in
// `boq-immutable.dbtest.ts`, deliberately not duplicated here).
//
// The pair under test is `boqs -> files` (`source_file_id`) and
// `boqs -> design_engagements` (`engagement_id`): the only two of the twelve
// whose child table also carries an immutability trigger, so they are the pair
// that exercises the most.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

interface Fixture {
  ctx: OrgContext;
  orgId: string;
  boqId: string;
  fileId: string;
  engagementId: string;
}

interface BoqRow {
  org_id: string;
  engagement_id: string | null;
  source_file_id: string | null;
  status: string;
}

/** The SQLSTATE of a rejected statement, or null if it was accepted. */
async function sqlstateOf(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown';
  }
}

/**
 * An org with a one-line BOQ carrying BOTH `on delete set null` parents, so each
 * cascade can be fired on its own. Built through the real cores, exactly as
 * `boq-immutable.dbtest.ts` builds its own - the spreadsheet and the engagement
 * are inserted directly because this file is about what the DATABASE does when
 * they are deleted, not about the upload or the engagement machine.
 */
async function setup(): Promise<Fixture> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');

  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});

  const created = await createBoqCore(ctx, {
    projectId: project.id,
    titleEn: 'Bill of Quantities',
  });
  const boqId = (created as { data?: string }).data!;
  await commitImportCore(ctx, {
    boqId,
    lines: [
      {
        itemCode: '2.01',
        section: 'Gypsum works',
        description: '12mm gypsum ceiling',
        unit: 'sqm',
        qty: '100',
        unitPrice: '1500',
        unitCost: '0',
        costItemCode: null,
        provisional: false,
      },
    ],
  });

  const [file] = await raw.query<{ id: string }>(
    `insert into public.files (org_id, entity, entity_id, object_key, original_name)
     values ('${orgId}', 'boq', null, '${orgId}/boq/import.xlsx', 'import.xlsx')
     returning id`,
  );
  const [engagement] = await raw.query<{ id: string }>(
    `insert into public.design_engagements (org_id, number, client_id, project_id, title_en)
     values ('${orgId}', 1, '${client.id}', '${project.id}', 'Fit-out design')
     returning id`,
  );
  // Attached while the BOQ is still a DRAFT, which is how the real paths do it
  // (the import sets source_file_id; issueBoqCore sets engagement_id).
  await raw.query(
    `update public.boqs
        set source_file_id = '${file.id}', engagement_id = '${engagement.id}'
      where id = '${boqId}'`,
  );

  return { ctx, orgId, boqId, fileId: file.id, engagementId: engagement.id };
}

/** Freeze it exactly the way `boqs/issue.ts:134-143` does, as metra_app. */
async function issue(fixture: Fixture): Promise<string | null> {
  return sqlstateOf(() =>
    withOrgContext(fixture.ctx, (tx) =>
      tx.execute(
        sql.raw(
          `update public.boqs
              set status = 'issued', issue_date = current_date, updated_at = now()
            where id = '${fixture.boqId}' and status = 'draft'`,
        ),
      ),
    ),
  );
}

async function boqRow(boqId: string): Promise<BoqRow> {
  const [row] = await raw.query<BoqRow>(
    `select org_id, engagement_id, source_file_id, status
       from public.boqs where id = '${boqId}'`,
  );
  return row;
}

describe('a composite set-null cascade nulls the reference and leaves org_id alone', () => {
  it('deletes the source FILE of a DRAFT boq: source_file_id goes null, org_id and the other parent do not', async () => {
    const fixture = await setup();

    expect(
      await sqlstateOf(() =>
        raw.query(`delete from public.files where id = '${fixture.fileId}'`),
      ),
    ).toBeNull();

    const row = await boqRow(fixture.boqId);
    // The narrowing, stated as three separate facts so a regression says which.
    expect(row.source_file_id).toBeNull();
    expect(row.org_id).toBe(fixture.orgId);
    expect(row.engagement_id).toBe(fixture.engagementId);
    expect(row.status).toBe('draft');
  });

  it('deletes the ENGAGEMENT of a DRAFT boq: engagement_id goes null, the spreadsheet stays attached', async () => {
    const fixture = await setup();

    expect(
      await sqlstateOf(() =>
        raw.query(
          `delete from public.design_engagements where id = '${fixture.engagementId}'`,
        ),
      ),
    ).toBeNull();

    const row = await boqRow(fixture.boqId);
    expect(row.engagement_id).toBeNull();
    expect(row.org_id).toBe(fixture.orgId);
    expect(row.source_file_id).toBe(fixture.fileId);
  });

  it('ADMITS the cascade on an ISSUED boq — the fourth TG_ARGV carries real traffic at last', async () => {
    // Wave 6 shipped `enforce_immutable_when`'s branch 2 with the honest note
    // that it could not be reached: it is fenced to `pg_trigger_depth() > 1`, so
    // only a referential action may null a named column on a locked row, and no
    // such action could complete while the FK nulled `org_id` too. This is the
    // first time the branch is exercised in the ADMITTING direction.
    const fixture = await setup();
    expect(await issue(fixture)).toBeNull();

    expect(
      await sqlstateOf(() =>
        raw.query(
          `delete from public.design_engagements where id = '${fixture.engagementId}'`,
        ),
      ),
    ).toBeNull();
    expect(
      await sqlstateOf(() =>
        raw.query(`delete from public.files where id = '${fixture.fileId}'`),
      ),
    ).toBeNull();

    const row = await boqRow(fixture.boqId);
    expect(row.engagement_id).toBeNull();
    expect(row.source_file_id).toBeNull();
    // The document is still issued, still in its org, and still has its line:
    // a cascade must not be a way to unfreeze or re-tenant an issued document.
    expect(row.status).toBe('issued');
    expect(row.org_id).toBe(fixture.orgId);
    const [lines] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.boq_lines where boq_id = '${fixture.boqId}'`,
    );
    expect(Number(lines.n)).toBe(1);
  });

  it('records the narrowing in the CATALOGUE: one set-null column, and it is not org_id', async () => {
    // Behaviour alone would also pass on a constraint someone re-created as
    // `on delete cascade`, which would silently delete issued BOQs. So the
    // catalogue is read directly: `confdelsetcols` is the field 0052 writes and
    // nothing else in the repo can see. No fixture: this is a catalogue read,
    // and seeding an org to perform it would only make the file slower.
    const fks = await raw.query<{
      conname: string;
      refcols: string[];
      setcols: string[] | null;
    }>(
      `select c.conname,
              (select array_agg(a.attname order by a.attnum)
                 from pg_attribute a
                where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) as refcols,
              (select array_agg(a.attname order by a.attnum)
                 from pg_attribute a
                where a.attrelid = c.conrelid and a.attnum = any(c.confdelsetcols)) as setcols
         from pg_constraint c
        where c.conrelid = 'public.boqs'::regclass
          and c.contype = 'f'
          and c.confdeltype = 'n'
        order by c.conname`,
    );
    expect(fks.length).toBe(2);
    for (const fk of fks) {
      expect(fk.refcols).toContain('org_id');
      expect(fk.setcols).not.toBeNull();
      expect(fk.setcols).toHaveLength(1);
      expect(fk.setcols).not.toContain('org_id');
    }
    expect(fks.map((fk) => fk.setcols![0]).sort()).toEqual([
      'engagement_id',
      'source_file_id',
    ]);
  });

  it('leaves NO composite set-null FK in the whole schema still nulling org_id', async () => {
    // The schema-wide version of the same read, and the one that would catch a
    // twelfth such FK added after 0052 ran. It is the same predicate 0052's own
    // straggler check uses, so this test and that migration cannot disagree
    // about what "narrowed" means.
    const stragglers = await raw.query<{ conname: string; table_name: string }>(
      `select c.conname, rel.relname as table_name
         from pg_constraint c
         join pg_class rel on rel.oid = c.conrelid
         join pg_namespace ns on ns.oid = rel.relnamespace
        where ns.nspname = 'public'
          and c.contype = 'f'
          and c.confdeltype = 'n'
          and array_length(c.conkey, 1) > 1
          and (
            coalesce(array_length(c.confdelsetcols, 1), 0) <> 1
            or (select a.attname from pg_attribute a
                 where a.attrelid = c.conrelid and a.attnum = c.confdelsetcols[1]) = 'org_id'
          )
        order by c.conname`,
    );
    expect(stragglers).toEqual([]);

    // And the count is still twelve, so a narrowing that was DROPPED rather than
    // fixed does not pass as "no stragglers". Eleven are declared in
    // `src/schema/`; the twelfth is `files_category_same_org_fk`, which 0040
    // created and no schema file declares - see 0052's header.
    const [narrowed] = await raw.query<{ n: number }>(
      `select count(*)::int as n
         from pg_constraint c
         join pg_class rel on rel.oid = c.conrelid
         join pg_namespace ns on ns.oid = rel.relnamespace
        where ns.nspname = 'public'
          and c.contype = 'f'
          and c.confdeltype = 'n'
          and array_length(c.conkey, 1) > 1`,
    );
    expect(Number(narrowed.n)).toBe(12);
  });
});
