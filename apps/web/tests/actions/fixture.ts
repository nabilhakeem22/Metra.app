import { randomUUID } from 'node:crypto';
import { createSql, type MemberRole } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';
import { TEARDOWN_ORDER } from './teardown-tables';

// Raw postgres (BYPASSRLS) connection for seed/teardown — bypasses the
// membership-gated policy so we can fabricate orgs without a real session.
const pg = createSql(process.env.DATABASE_URL as string, {
  max: 3,
  prepare: false,
});

/**
 * Every org this process has seeded and not yet torn down.
 *
 * THE LEAK THIS CLOSES: teardown only ran from a suite's `afterAll`, so an
 * interrupted run — Ctrl-C, a killed stream, a crashed worker — left its orgs
 * behind forever. The shared database accumulated 480 of them. The set below is
 * the process-wide record of what is outstanding, and `closeFixture` (which every
 * suite already calls) and the signal handlers sweep whatever is still in it, so
 * cleanup no longer depends on a hook that may never fire.
 */
const OUTSTANDING_ORG_IDS = new Set<string>();

/**
 * A fixture org's name. The marker makes debris identifiable at a glance and the
 * ISO timestamp says WHEN it leaked, so a future purge can tell a run from
 * yesterday apart from one still in flight.
 */
export function fixtureOrgName(): string {
  return `${FIXTURE_ORG_MARKER} ${new Date().toISOString()}`;
}

/** The prefix every fixture-created org and account name starts with. */
export const FIXTURE_ORG_MARKER = 'Test Org';

export function ctxFor(
  orgId: string,
  userId: string,
  role: MemberRole,
  email?: string,
): OrgContext {
  return { orgId, userId, role, email };
}

export interface SeededOrg {
  orgId: string;
  ownerIds: string[];
  memberIds: string[];
}

export async function seedOrg(opts: {
  owners?: number;
  members?: Array<{ role: MemberRole }>;
}): Promise<SeededOrg> {
  const orgId = randomUUID();
  const name = fixtureOrgName();
  OUTSTANDING_ORG_IDS.add(orgId);
  // Every org owns exactly one account (above tenancy, A1). Seeded over the
  // BYPASSRLS connection (bypasses the accounts WITH CHECK) then linked; teardown
  // removes it AFTER the org (FK is on delete restrict).
  const accountId = randomUUID();
  await pg.unsafe(
    `insert into public.accounts (id, name_en) values ('${accountId}', '${name}')`,
  );
  await pg.unsafe(
    `insert into public.organizations (id, account_id, name_en) values ('${orgId}', '${accountId}', '${name}')`,
  );

  // Seed the default automation_settings row (mirrors the 0016 backfill /
  // createOrgCore) so automation cores have config to read.
  await pg.unsafe(
    `insert into public.automation_settings (org_id) values ('${orgId}')`,
  );

  // Seed the default document categories (mirrors createOrgCore + the 0040
  // backfill) so document uploads have a real vocabulary to file under.
  await pg.unsafe(
    `insert into public.document_categories (org_id, key, name_en, name_ar, sort_order)
     select '${orgId}', d.key, d.name_en, d.name_ar, d.sort_order
     from (values
       ('contract','Contracts','العقود',0),
       ('commercial','Commercial & tax','مستندات تجارية وضريبية',1),
       ('drawings','Drawings','الرسومات',2),
       ('correspondence','Correspondence','المراسلات',3),
       ('invoices','Invoices','الفواتير',4),
       ('other','Other','أخرى',5)
     ) as d(key, name_en, name_ar, sort_order)`,
  );

  // Seed the 8 default sections (mirrors createOrgCore) so Price Book + builder
  // cores have a valid section_id to reference.
  await pg.unsafe(
    `insert into public.sections (org_id, key, name_en, name_ar)
     select '${orgId}', d.key, d.name_en, d.name_ar
     from (values
       ('civil','Civil','أعمال مدنية'),
       ('gypsum','Gypsum','جبس'),
       ('electrical','Electrical','كهرباء'),
       ('plumbing','Plumbing','سباكة'),
       ('joinery','Joinery','نجارة'),
       ('finishes','Finishes','تشطيبات'),
       ('furniture','Furniture','أثاث'),
       ('preliminaries','Preliminaries','أعمال تمهيدية')
     ) as d(key, name_en, name_ar)`,
  );

  // Seed the 5 default project types + 10 default stage templates (mirrors
  // createOrgCore) so project cores have valid config to read.
  await pg.unsafe(
    `insert into public.project_types (org_id, key, name_en, name_ar, sort_order)
     select '${orgId}', d.key, d.name_en, d.name_ar, d.sort_order
     from (values
       ('villa','Villa','فيلا',0),
       ('apartment','Apartment','شقة',1),
       ('office','Office','مكتب',2),
       ('retail','Retail','محل تجاري',3),
       ('restaurant','Restaurant','مطعم',4)
     ) as d(key, name_en, name_ar, sort_order)`,
  );
  await pg.unsafe(
    `insert into public.stage_templates (org_id, key, name_en, name_ar, sort_order)
     select '${orgId}', d.key, d.name_en, d.name_ar, d.sort_order
     from (values
       ('design_drawings','Design & drawings','التصميم والرسومات',0),
       ('civil_demolition','Civil & demolition','الأعمال المدنية والهدم',1),
       ('mep_first_fix','MEP first fix','التمديدات الأولية',2),
       ('gypsum_plaster','Gypsum & plaster','الجبس والمحارة',3),
       ('flooring_tiling','Flooring & tiling','الأرضيات والبلاط',4),
       ('painting_finishes','Painting & finishes','الدهانات والتشطيبات',5),
       ('joinery','Joinery','النجارة',6),
       ('mep_second_fix','MEP second fix','التمديدات النهائية',7),
       ('snagging','Snagging','المعالجات',8),
       ('handover','Handover','التسليم',9)
     ) as d(key, name_en, name_ar, sort_order)`,
  );

  const ownerIds: string[] = [];
  for (let i = 0; i < (opts.owners ?? 1); i += 1) {
    const uid = randomUUID();
    ownerIds.push(uid);
    await pg.unsafe(
      `insert into public.memberships (id, org_id, user_id, role)
       values (gen_random_uuid(), '${orgId}', '${uid}', 'owner')`,
    );
  }

  const memberIds: string[] = [];
  for (const m of opts.members ?? []) {
    const uid = randomUUID();
    memberIds.push(uid);
    await pg.unsafe(
      `insert into public.memberships (id, org_id, user_id, role)
       values (gen_random_uuid(), '${orgId}', '${uid}', '${m.role}')`,
    );
  }

  // Per-workspace entitlements (A2): the `interior` flow enabled, so the flow-
  // gated cores (engagements) proceed for the fixture org. Seeded over the
  // BYPASSRLS connection (like accounts) AFTER the memberships above.
  await pg.unsafe(
    `insert into public.workspace_entitlements (org_id, enabled_flows)
     values ('${orgId}', '{interior}')`,
  );

  return { orgId, ownerIds, memberIds };
}

export async function seedPendingInvite(
  orgId: string,
  email: string,
  invitedBy: string,
  role: MemberRole = 'viewer',
): Promise<string> {
  const id = randomUUID();
  await pg.unsafe(
    `insert into public.invitations
       (id, org_id, email, role, token_hash, status, invited_by, expires_at)
     values ('${id}', '${orgId}', '${email.toLowerCase()}', '${role}',
             'hash-${id}', 'pending', '${invitedBy}', now() + interval '7 days')`,
  );
  return id;
}

/** Read helpers over the BYPASSRLS connection (for assertions). */
export const raw = {
  async count(table: string, orgId: string): Promise<number> {
    const rows = await pg.unsafe(
      `select count(*)::int as n from public.${table} where org_id = '${orgId}'`,
    );
    return Number((rows as unknown as Array<{ n: number }>)[0].n);
  },
  async memberships(orgId: string) {
    return (await pg.unsafe(
      `select user_id, role from public.memberships where org_id = '${orgId}'`,
    )) as unknown as Array<{ user_id: string; role: string }>;
  },
  /** A seeded section's id by key (default 'civil') — for cost-item cores. */
  async sectionId(orgId: string, key = 'civil'): Promise<string> {
    const rows = (await pg.unsafe(
      `select id from public.sections where org_id = '${orgId}' and key = '${key}' limit 1`,
    )) as unknown as Array<{ id: string }>;
    return rows[0].id;
  },
  /** Arbitrary read over the BYPASSRLS connection. */
  async query<T = Record<string, unknown>>(text: string): Promise<T[]> {
    return (await pg.unsafe(text)) as unknown as T[];
  },
};

export async function teardown(orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  // One transaction on a single pinned connection so SET LOCAL applies to every
  // delete and resets automatically when the transaction ends.
  await pg.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = 'replica'`);
    for (const id of orgIds) {
      // TEARDOWN_ORDER ends with the polymorphic `files`, which every table that
      // points at it has already been cleared from.
      for (const table of TEARDOWN_ORDER) {
        await tx.unsafe(`delete from public.${table} where org_id = '${id}'`);
      }
      // Capture the owning account BEFORE dropping the org, then delete the org,
      // then the now-unreferenced account (accounts have no org_id; the FK is on
      // delete restrict, so the account must go AFTER its org).
      const owned = (await tx.unsafe(
        `select account_id from public.organizations where id = '${id}'`,
      )) as unknown as Array<{ account_id: string | null }>;
      await tx.unsafe(`delete from public.organizations where id = '${id}'`);
      const accountId = owned[0]?.account_id;
      if (accountId) {
        await tx.unsafe(`delete from public.accounts where id = '${accountId}'`);
      }
      OUTSTANDING_ORG_IDS.delete(id);
    }
  });
}

/**
 * Tear down every org this process seeded and has not yet removed. Safe to call
 * repeatedly: teardown clears each id from the set as it goes, so a suite that
 * already ran its own afterAll leaves nothing here to do.
 */
export async function teardownOutstanding(): Promise<void> {
  await teardown([...OUTSTANDING_ORG_IDS]);
}

export async function closeFixture(): Promise<void> {
  // The LAST line of defence, and the one that always runs: every suite calls
  // this, so even a file whose afterAll teardown threw part-way still leaves
  // nothing behind.
  try {
    await teardownOutstanding();
  } finally {
    await pg.end();
  }
}

// AND the interrupted-run case, which is what actually filled the shared
// database: Ctrl-C and a killed process never reach any vitest hook. These
// handlers get one attempt at a sweep before the process leaves. `once`, so a
// second interrupt during the sweep exits immediately rather than hanging.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void teardownOutstanding()
      .catch((error) => {
        console.error('fixture sweep on', signal, 'failed:', error);
      })
      .finally(() => {
        void pg.end().finally(() => process.exit(1));
      });
  });
}
