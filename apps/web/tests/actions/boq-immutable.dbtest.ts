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
// (schema/boqs.ts:79-82), so deleting a design engagement, or deleting the
// imported spreadsheet, makes POSTGRES ITSELF update an issued BOQ row. Without
// the fourth argument the trigger would raise MT100 and abort a delete that has
// nothing to do with immutability - a user-visible break of a path that works
// today. Both cascades are asserted below, not just the file one.
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
  boqId: string;
  lineId: string;
  fileId: string;
  engagementId: string;
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
    boqId,
    lineId: line.id,
    fileId: file.id,
    engagementId: engagement.id,
  };
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
    const code = await sqlstateOf(() =>
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

  it('refuses a DELETE of an issued BOQ twice over: no grant, and MT100', async () => {
    const fixture = await setup();
    expect(await issue(fixture)).toBeNull();

    // As metra_app the GRANT is the first fence: roles.sql revokes delete.
    const asApp = await sqlstateOf(() =>
      withOrgContext(fixture.ctx, (tx) =>
        tx.execute(sql.raw(`delete from public.boqs where id = '${fixture.boqId}'`)),
      ),
    );
    expect(asApp).toBe('42501');

    // On the owning (BYPASSRLS) connection the grant does not apply and the
    // TRIGGER is what refuses. Two independent fences, and this is the one that
    // survives a future re-grant.
    const asOwner = await sqlstateOf(() =>
      raw.query(`delete from public.boqs where id = '${fixture.boqId}'`),
    );
    expect(asOwner).toBe('MT100');

    const [row] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.boqs where id = '${fixture.boqId}'`,
    );
    expect(row.n).toBe(1);
  });

  it('still lets the imported SOURCE FILE be deleted (the 4th-TG_ARGV cascade)', async () => {
    const fixture = await setup();
    expect(await issue(fixture)).toBeNull();

    const code = await sqlstateOf(() =>
      raw.query(`delete from public.files where id = '${fixture.fileId}'`),
    );
    expect(code).toBeNull();

    const [row] = await raw.query<{ source_file_id: string | null; status: string }>(
      `select source_file_id, status from public.boqs where id = '${fixture.boqId}'`,
    );
    expect(row.source_file_id).toBeNull();
    expect(row.status).toBe('issued');
  });

  it('still lets the design ENGAGEMENT be deleted (the same cascade, other column)', async () => {
    const fixture = await setup();
    expect(await issue(fixture)).toBeNull();

    const code = await sqlstateOf(() =>
      raw.query(
        `delete from public.design_engagements where id = '${fixture.engagementId}'`,
      ),
    );
    expect(code).toBeNull();

    const [row] = await raw.query<{ engagement_id: string | null; status: string }>(
      `select engagement_id, status from public.boqs where id = '${fixture.boqId}'`,
    );
    expect(row.engagement_id).toBeNull();
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
    const code = await sqlstateOf(() =>
      raw.query(
        `update public.boqs set source_file_id = '${other.id}' where id = '${fixture.boqId}'`,
      ),
    );
    expect(code).toBe('MT100');
  });
});
