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
  await pg.unsafe(
    `insert into public.organizations (id, name_en) values ('${orgId}', 'Test Org')`,
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
  /** Arbitrary read over the BYPASSRLS connection. */
  async query<T = Record<string, unknown>>(text: string): Promise<T[]> {
    return (await pg.unsafe(text)) as unknown as T[];
  },
};

export async function teardown(orgIds: string[]): Promise<void> {
  for (const id of orgIds) {
    await pg.unsafe(`delete from public.price_change_lines where org_id='${id}'`);
    await pg.unsafe(`delete from public.price_changes where org_id='${id}'`);
    await pg.unsafe(`delete from public.cost_items where org_id='${id}'`);
    await pg.unsafe(`delete from public.audit_log where org_id='${id}'`);
    await pg.unsafe(`delete from public.invitations where org_id='${id}'`);
    await pg.unsafe(`delete from public.memberships where org_id='${id}'`);
    await pg.unsafe(`delete from public.organizations where id='${id}'`);
  }
}

export async function closeFixture(): Promise<void> {
  await pg.end();
}
