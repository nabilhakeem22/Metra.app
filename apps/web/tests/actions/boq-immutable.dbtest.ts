import { sqlstateOf } from '@metra/db/sqlstate';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { commitImportCore, createBoqCore } from '@/lib/boqs/core';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

// Decision 8, second batch: a BOQ is frozen at the DATABASE once it leaves
// 'draft'. Until now that was seven TypeScript guards and nothing else, so a
// direct write - a future action, a script, a migration's backfill - could edit a
// document that has already been issued to a client.
//
// The load-bearing case here is the FOURTH TG_ARGV. `boqs.engagement_id` and
// `boqs.source_file_id` are both declared `on delete set null`
// (schema/boqs.ts:79-82), so Postgres's referential action UPDATES an issued BOQ
// row, and without the fourth argument the trigger raises MT100 on it.
//
// WHEN THIS FILE WAS WRITTEN THAT DELETE COULD NOT COMPLETE AT ALL. The FK is
// COMPOSITE, `(org_id, x_id) -> target(org_id, id)`, and `ON DELETE SET NULL`
// with no column list nulls ALL of the referencing columns - `org_id` included,
// which is `not null` - so the parent delete was refused whether or not the BOQ
// was issued. `0052_composite_fk_set_null_columns.sql` narrowed all eleven such
// FKs to `ON DELETE SET NULL (x_id)`, which is what finally gives the fourth
// argument real traffic; the LAST test in this file was inverted by that
// migration and says so in full.
//
// The branch is fenced to `pg_trigger_depth() > 1` - only a referential action
// may null those columns - so it can never be exercised by issuing the statement
// the cascade WOULD issue by hand. Both halves are asserted: the cascade is
// admitted (last case), and a DIRECT null of either column on an issued BOQ is
// still MT100.
//
// TEARDOWN NEEDS NOTHING NEW: fixture.ts:314 sets
// `session_replication_role = 'replica'` for the whole teardown transaction,
// which disables user triggers for that session, so an issued BOQ is deleted
// exactly as a draft one is. Do NOT add a status reset to teardown.

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

interface Fixture {
  ctx: OrgContext;
  projectId: string;
  boqId: string;
  lineId: string;
  fileId: string;
  engagementId: string;
}

/**
 * The SQLSTATE of a rejected statement, or null if it was accepted. Read
 * through `sqlstateOf`: these statements run through the ORM, which from
 * drizzle 0.44 wraps the driver's error and moves the code onto `.cause`.
 */
async function refusalSqlstate(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return sqlstateOf(error) ?? 'unknown';
  }
}

/**
 * An org with a one-line BOQ that carries BOTH `on delete set null` parents, so
 * each cascade can be triggered independently.
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

  // The imported spreadsheet and the design engagement, created directly: this
  // test is about what the DATABASE does when they are deleted, not about the
  // upload or the engagement machine.
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

  const [line] = await raw.query<{ id: string }>(
    `select id from public.boq_lines where boq_id = '${boqId}' limit 1`,
  );
  return {
    ctx,
    projectId: project.id,
    boqId,
    lineId: line.id,
    fileId: file.id,
    engagementId: engagement.id,
  };
}

/**
 * A second, still-DRAFT BOQ in the same org with one line of its own — the
 * re-parenting target, built through the same import path as `setup()` so its
 * line carries a real section and passes every CHECK.
 */
async function draftSibling(fixture: Fixture): Promise<{ boqId: string; lineId: string }> {
  const created = await createBoqCore(fixture.ctx, {
    projectId: fixture.projectId,
    titleEn: 'Second bill',
  });
  const boqId = (created as { data?: string }).data!;
  await commitImportCore(fixture.ctx, {
    boqId,
    lines: [
      {
        itemCode: '9.01',
        section: 'Joinery',
        description: 'Loose line',
        unit: 'sqm',
        qty: '1',
        unitPrice: '1',
        unitCost: '0',
        costItemCode: null,
        provisional: false,
      },
    ],
  });
  const [line] = await raw.query<{ id: string }>(
    `select id from public.boq_lines where boq_id = '${boqId}' limit 1`,
  );
  return { boqId, lineId: line.id };
}

/** Freeze it exactly the way `boqs/issue.ts:134-143` does, as metra_app. */
async function issue(fixture: Fixture): Promise<string | null> {
  return refusalSqlstate(() =>
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

describe('a BOQ is frozen at the database once it is issued', () => {
  it('admits the draft -> issued transition, because the OLD row is still draft', async () => {
    const fixture = await setup();
    expect(await issue(fixture)).toBeNull();
    const [row] = await raw.query<{ status: string }>(
      `select status from public.boqs where id = '${fixture.boqId}'`,
    );
    expect(row.status).toBe('issued');
  });

  it('refuses an UPDATE of a line on an issued BOQ with MT100', async () => {
    const fixture = await setup();
    expect(await issue(fixture)).toBeNull();
    const code = await refusalSqlstate(() =>
      withOrgContext(fixture.ctx, (tx) =>
        tx.execute(
          sql.raw(
            `update public.boq_lines set qty = '5' where id = '${fixture.lineId}'`,
          ),
        ),
      ),
    );
    expect(code).toBe('MT100');
    const [line] = await raw.query<{ qty: string }>(
      `select qty from public.boq_lines where id = '${fixture.lineId}'`,
    );
    expect(Number(line.qty)).toBe(100);
  });

  it('refuses RE-PARENTING a line OUT of an issued BOQ, not only INTO one', async () => {
    // The hole the clone of enforce_contract_child_draft carried: on UPDATE the
    // trigger read only NEW's parent, so moving a line from an ISSUED BOQ to a
    // DRAFT one was admitted - the status read was of the draft target, `boqs`
    // itself is never touched so trg_boqs_immutable does not fire, and metra_app
    // holds `update` on boq_lines. The issued document loses a line while its
    // cached subtotal / total / total_cost stay at the issued figures.
    const fixture = await setup();
    const draft = await draftSibling(fixture);
    expect(await issue(fixture)).toBeNull();

    // OUT of the issued BOQ, into a draft one. OLD's parent is what refuses.
    const out = await refusalSqlstate(() =>
      withOrgContext(fixture.ctx, (tx) =>
        tx.execute(
          sql.raw(
            `update public.boq_lines set boq_id = '${draft.boqId}' where id = '${fixture.lineId}'`,
          ),
        ),
      ),
    );
    expect(out).toBe('MT100');

    // The line is still where it was, and still counted by the issued BOQ.
    const [line] = await raw.query<{ boq_id: string }>(
      `select boq_id from public.boq_lines where id = '${fixture.lineId}'`,
    );
    expect(line.boq_id).toBe(fixture.boqId);

    // The direction that always worked, asserted so the OLD check cannot be
    // mistaken for having REPLACED the NEW one: the draft sibling's own line
    // cannot be moved INTO the issued BOQ either.
    const into = await refusalSqlstate(() =>
      withOrgContext(fixture.ctx, (tx) =>
        tx.execute(
          sql.raw(
            `update public.boq_lines set boq_id = '${fixture.boqId}' where id = '${draft.lineId}'`,
          ),
        ),
      ),
    );
    expect(into).toBe('MT100');
  });

  it('refuses a DELETE of an issued BOQ twice over: no grant, and MT100', async () => {
    const fixture = await setup();
    expect(await issue(fixture)).toBeNull();

    // As metra_app the GRANT is the first fence: roles.sql revokes delete.
    const asApp = await refusalSqlstate(() =>
      withOrgContext(fixture.ctx, (tx) =>
        tx.execute(sql.raw(`delete from public.boqs where id = '${fixture.boqId}'`)),
      ),
    );
    expect(asApp).toBe('42501');

    // On the owning (BYPASSRLS) connection the grant does not apply and the
    // TRIGGER is what refuses. Two independent fences, and this is the one that
    // survives a future re-grant.
    const asOwner = await refusalSqlstate(() =>
      raw.query(`delete from public.boqs where id = '${fixture.boqId}'`),
    );
    expect(asOwner).toBe('MT100');

    const [row] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.boqs where id = '${fixture.boqId}'`,
    );
    expect(row.n).toBe(1);
  });

  it('refuses a DIRECT null of a cascade column on an issued BOQ (4th TG_ARGV, depth-gated)', async () => {
    // THIS CASE'S EXPECTATION WAS INVERTED ON PURPOSE, and it is the only test
    // in this file that changed meaning. As first shipped, the fourth TG_ARGV
    // could not tell a referential cascade from a hand-written statement, so
    // these two UPDATEs were ADMITTED on a BOQ already issued to a client -
    // detaching it from its design engagement, and detaching the spreadsheet the
    // client was actually sent. Both raised MT100 before the argument existed,
    // and metra_app holds `update` on boqs, so the widening was reachable by any
    // future code path.
    //
    // `pg_trigger_depth() > 1` now fences branch 2 to a referential action: a
    // cascade reaches the child's BEFORE UPDATE from inside the parent's
    // internal RI trigger (depth >= 2), a direct UPDATE arrives at depth 1.
    //
    // THE ADMITTING HALF OF BRANCH 2 IS THE LAST TEST IN THIS FILE, and it only
    // became reachable with 0052's `ON DELETE SET NULL (x_id)` narrowing. THIS
    // case is the refusing half, and it is the security property the depth fence
    // buys: the same column, nulled by hand rather than by a cascade, is MT100.
    const fixture = await setup();
    expect(await issue(fixture)).toBeNull();

    expect(
      await refusalSqlstate(() =>
        raw.query(
          `update public.boqs set engagement_id = null where id = '${fixture.boqId}'`,
        ),
      ),
    ).toBe('MT100');
    expect(
      await refusalSqlstate(() =>
        raw.query(
          `update public.boqs set source_file_id = null where id = '${fixture.boqId}'`,
        ),
      ),
    ).toBe('MT100');

    // A bare timestamp bump is refused too: branch 2 used to strip `updated_at`
    // unconditionally, so a locked document's timestamp could be moved on its
    // own. It is now forgiven only when a named column actually went NULL.
    expect(
      await refusalSqlstate(() =>
        raw.query(`update public.boqs set updated_at = now() where id = '${fixture.boqId}'`),
      ),
    ).toBe('MT100');

    // Nothing moved.
    const [row] = await raw.query<{
      engagement_id: string | null;
      source_file_id: string | null;
      status: string;
    }>(
      `select engagement_id, source_file_id, status from public.boqs where id = '${fixture.boqId}'`,
    );
    expect(row.engagement_id).toBe(fixture.engagementId);
    expect(row.source_file_id).toBe(fixture.fileId);
    expect(row.status).toBe('issued');
  });

  it('still refuses a NON-NULL write to a cascade column on an issued BOQ', async () => {
    // The fourth argument tolerates a change TO NULL and nothing else. Without
    // this case, "columns the database may null out" could quietly become
    // "columns anyone may rewrite".
    const fixture = await setup();
    expect(await issue(fixture)).toBeNull();

    const [other] = await raw.query<{ id: string }>(
      `insert into public.files (org_id, entity, entity_id, object_key, original_name)
       values ('${fixture.ctx.orgId}', 'boq', null, '${fixture.ctx.orgId}/boq/other.xlsx', 'other.xlsx')
       returning id`,
    );
    const code = await refusalSqlstate(() =>
      raw.query(
        `update public.boqs set source_file_id = '${other.id}' where id = '${fixture.boqId}'`,
      ),
    );
    expect(code).toBe('MT100');
  });

  it('CAN use the real cascade now that 0052 narrowed the FK, and org_id survives it', async () => {
    // THIS CASE WAS INVERTED BY MIGRATION 0052, AND THAT IS THE POINT OF THE
    // MIGRATION. As shipped in wave 6 it asserted the DEFECT it had just found:
    // `boqs.engagement_id` and `boqs.source_file_id` are the second column of a
    // COMPOSITE foreign key, (org_id, x_id) -> target(org_id, id), and
    // Postgres's `ON DELETE SET NULL` with no column list set ALL of the
    // referencing columns to null - `org_id` included, which is `not null` on
    // every org-scoped table. The referential action produced a row the table
    // could not hold, so deleting the parent was refused whether or not the BOQ
    // was issued (23502 on a draft row; MT100 on an issued one, only because a
    // BEFORE trigger runs before the not-null check).
    //
    // `0052_composite_fk_set_null_columns.sql` narrows all eleven such FKs to
    // `ON DELETE SET NULL (<x>_id)`. The old expectations are now WRONG - they
    // encoded the bug - so they are replaced rather than relaxed. The full
    // positive proof (both parents, both statuses, the schema-wide straggler
    // read) lives in `composite-fk-cascade.dbtest.ts`; what stays HERE is the
    // half that belongs to this file: the cascade the immutability trigger's
    // fourth TG_ARGV exists for is ADMITTED, and it is the ONLY way those
    // columns may go null on an issued BOQ - the direct statement two cases
    // above is still MT100.
    const fixture = await setup();

    const asDraft = await refusalSqlstate(() =>
      raw.query(`delete from public.files where id = '${fixture.fileId}'`),
    );
    expect(await issue(fixture)).toBeNull();
    const asIssued = await refusalSqlstate(() =>
      raw.query(
        `delete from public.design_engagements where id = '${fixture.engagementId}'`,
      ),
    );
    expect(asDraft).toBeNull();
    expect(asIssued).toBeNull();

    // The row is still there, still issued, still in its org - only the two
    // references went.
    const [row] = await raw.query<{
      org_id: string;
      engagement_id: string | null;
      source_file_id: string | null;
      status: string;
    }>(
      `select org_id, engagement_id, source_file_id, status
         from public.boqs where id = '${fixture.boqId}'`,
    );
    expect(row.org_id).toBe(fixture.ctx.orgId);
    expect(row.engagement_id).toBeNull();
    expect(row.source_file_id).toBeNull();
    expect(row.status).toBe('issued');

    // THE MECHANISM, from the catalogue rather than from the behaviour: both
    // constraints are still SET NULL (confdeltype = 'n') over TWO referencing
    // columns, and the set-null list now names exactly ONE of them - never
    // org_id. Behaviour alone would also pass on a constraint re-created as
    // `on delete cascade`, which would delete issued BOQs outright.
    const fks = await raw.query<{
      conname: string;
      ncols: number;
      cols: string[];
      setcols: string[] | null;
    }>(
      `select c.conname,
              array_length(c.conkey, 1) as ncols,
              (select array_agg(a.attname order by a.attnum)
                 from pg_attribute a
                where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) as cols,
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
      expect(Number(fk.ncols)).toBe(2);
      expect(fk.cols).toContain('org_id');
      expect(fk.setcols).toHaveLength(1);
      expect(fk.setcols).not.toContain('org_id');
    }
  });
});
