import { randomUUID } from 'node:crypto';
import { createSql, type MemberRole } from '@metra/db';
import type { OrgContext } from '@/lib/db/context';

// Raw postgres (BYPASSRLS) connection for seed/teardown — bypasses the
// membership-gated policy so we can fabricate orgs without a real session.
const pg = createSql(process.env.DATABASE_URL as string, {
  max: 3,
  prepare: false,
});

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
  // Every org owns exactly one account (above tenancy, A1). Seeded over the
  // BYPASSRLS connection (bypasses the accounts WITH CHECK) then linked; teardown
  // removes it AFTER the org (FK is on delete restrict).
  const accountId = randomUUID();
  await pg.unsafe(
    `insert into public.accounts (id, name_en) values ('${accountId}', 'Test Org')`,
  );
  await pg.unsafe(
    `insert into public.organizations (id, account_id, name_en) values ('${orgId}', '${accountId}', 'Test Org')`,
  );

  // Seed the default automation_settings row (mirrors the 0016 backfill /
  // createOrgCore) so automation cores have config to read.
  await pg.unsafe(
    `insert into public.automation_settings (org_id) values ('${orgId}')`,
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

// Delete order is FK-safe on its own, but proposals/contracts/VOs are frozen once
// they leave draft (immutability + child-draft triggers block even a BYPASSRLS
// DELETE). We suppress those triggers SESSION-LOCALLY via
// `SET LOCAL session_replication_role = 'replica'` inside a single transaction —
// which disables user triggers for THIS session only and auto-resets on commit.
// It never touches other sessions/tenants and takes no ACCESS EXCLUSIVE lock, so
// it can't globally disable prod immutability or serialize concurrent test runs
// (the bug of the old `ALTER TABLE ... DISABLE TRIGGER`, which is global).
const TEARDOWN_TABLES_IN_FK_ORDER = [
  // Contracts + VOs first: VOs reference contracts (restrict) and contracts
  // reference proposals (restrict), so tear these down BEFORE proposals.
  'variation_order_events',
  'variation_order_lines',
  'variation_orders',
  'contract_events',
  'contract_lines',
  'contract_sections',
  'contracts',
  // Design engagements: the milestone schedule + transition ledger cascade from
  // engagements; the engagement references clients + projects (restrict), so tear
  // the children down first, then engagements, before clients/projects.
  // client_payment_claims references payment_events (set null) + design_engagements
  // (cascade) — delete it before both so no restrict/order surprise.
  'client_payment_claims',
  // engagement_document_comments cascades from BOTH design_engagements and
  // engagement_artifacts, so the deletes below would clear it either way — listed
  // explicitly so a future FK change surfaces here rather than as a restrict error.
  'engagement_document_comments',
  'payment_events',
  'engagement_events',
  'engagement_change_orders',
  'engagement_artifacts',
  'engagement_milestones',
  'engagement_transitions',
  'design_engagements',
  'proposal_events',
  'proposal_lines',
  'proposal_sections',
  'proposals',
  'price_change_lines',
  'price_changes',
  'project_stages',
  // projects reference clients (restrict) -> delete projects before clients.
  'projects',
  'project_types',
  'stage_templates',
  'activities',
  'client_contacts',
  'clients',
  'cost_items',
  // sections are referenced by cost_items (restrict) -> after cost_items.
  'sections',
  'notifications',
  'automation_run_log',
  'automation_settings',
  'audit_log',
  'invitations',
  'api_keys',
  // workspace_entitlements references organizations (restrict) -> before the org.
  'workspace_entitlements',
  'memberships',
];

export async function teardown(orgIds: string[]): Promise<void> {
  // One transaction on a single pinned connection so SET LOCAL applies to every
  // delete and resets automatically when the transaction ends.
  await pg.begin(async (tx) => {
    await tx.unsafe(`set local session_replication_role = 'replica'`);
    for (const id of orgIds) {
      for (const table of TEARDOWN_TABLES_IN_FK_ORDER) {
        await tx.unsafe(`delete from public.${table} where org_id = '${id}'`);
      }
      // `files` is polymorphic (project + client entities) — clear both.
      await tx.unsafe(`delete from public.files where org_id = '${id}'`);
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
    }
  });
}

export async function closeFixture(): Promise<void> {
  await pg.end();
}
