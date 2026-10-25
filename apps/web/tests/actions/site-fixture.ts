// Stage 3 (0064) DB-test fixture: site diary rows written by direct SQL, before
// any core writes one (S4 to S6 build them). Not a test file. Seeds go over the
// BYPASSRLS connection; a write that stands for an app write goes through
// `appQuery` (metra_app, a member's org context), so RLS, the restrictive
// insert policy and the grants apply. Teardown is fixture.ts's (TEARDOWN_ORDER
// carries the seven site tables).
import { randomUUID } from 'node:crypto';
import type { MemberRole } from '@metra/db';
import { appQuery, appQueryInSession, ownerQuery } from './execution-fixture';

/** A new member of `orgId` with `role`, over the BYPASSRLS connection. */
export async function seedMember(orgId: string, role: MemberRole): Promise<string> {
  const userId = randomUUID();
  await ownerQuery(`insert into public.memberships (org_id, user_id, role) values ($1, $2, $3)`, [
    orgId,
    userId,
    role,
  ]);
  return userId;
}

/** A live assignment of `userId` on `projectId`. */
export async function seedAssignment(
  orgId: string,
  projectId: string,
  userId: string,
  assignedBy: string,
): Promise<string> {
  const [row] = await ownerQuery<{ id: string }>(
    `insert into public.project_assignments (org_id, project_id, user_id, assigned_by)
     values ($1, $2, $3, $4) returning id`,
    [orgId, projectId, userId, assignedBy],
  );
  return row.id;
}

/** Column values, keyed by column name, for one INSERT. */
export type Row = Record<string, unknown>;

/** `insert into public.<table> (<keys>) values (<params>) returning id`. */
export function insertSql(table: string, row: Row): { text: string; params: unknown[] } {
  const columns = Object.keys(row);
  return {
    text: `insert into public.${table} (${columns.join(', ')})
           values (${columns.map((_, i) => `$${String(i + 1)}`).join(', ')}) returning id`,
    params: Object.values(row),
  };
}

/** A check-in with no location (the shape that needs no consent and no pin). */
export function visitRow(orgId: string, projectId: string, userId: string, fields: Row = {}): Row {
  return {
    org_id: orgId,
    project_id: projectId,
    user_id: userId,
    client_key: randomUUID(),
    visit_date: '2026-10-24',
    checked_in_at: '2026-10-24T07:30:00Z',
    location_status: 'declined',
    presence: 'no_location',
    ...fields,
  };
}

/** A pending camera photo row (its object keys are derived, never stored). */
export function photoRow(orgId: string, projectId: string, visitId: string, userId: string, fields: Row = {}): Row {
  return {
    org_id: orgId,
    project_id: projectId,
    visit_id: visitId,
    client_key: randomUUID(),
    uploaded_by: userId,
    storage_provider: 'r2',
    display_bytes: 300_000,
    thumb_bytes: 20_000,
    width: 1600,
    height: 1200,
    content_type: 'image/jpeg',
    taken_at: '2026-10-24T08:00:00Z',
    source: 'camera',
    ...fields,
  };
}

export function materialRow(orgId: string, projectId: string, visitId: string, userId: string, fields: Row = {}): Row {
  return {
    org_id: orgId,
    project_id: projectId,
    visit_id: visitId,
    client_key: randomUUID(),
    recorded_by: userId,
    description: 'Cement',
    qty: '10',
    unit: 'bag',
    ...fields,
  };
}

export function noteRow(orgId: string, projectId: string, visitId: string, userId: string, fields: Row = {}): Row {
  return {
    org_id: orgId,
    project_id: projectId,
    visit_id: visitId,
    client_key: randomUUID(),
    author_id: userId,
    kind: 'progress',
    body: 'Tiling started on the ground floor',
    ...fields,
  };
}

/** Insert over the BYPASSRLS connection; the new row's id. */
export async function ownerInsert(table: string, row: Row): Promise<string> {
  const { text, params } = insertSql(table, row);
  const [inserted] = await ownerQuery<{ id: string }>(text, params);
  return inserted.id;
}

/** Insert as metra_app in `userId`'s context in `orgId`; the new row's id. */
export async function appInsert(orgId: string, userId: string, table: string, row: Row): Promise<string> {
  const { text, params } = insertSql(table, row);
  const [inserted] = await appQuery<{ id: string }>(orgId, userId, text, params);
  return inserted.id;
}

/** appInsert from the auth session `sessionId` (the site device policies read it). */
export async function appInsertInSession(
  orgId: string,
  userId: string,
  sessionId: string,
  table: string,
  row: Row,
): Promise<string> {
  const { text, params } = insertSql(table, row);
  const [inserted] = await appQueryInSession<{ id: string }>(orgId, userId, sessionId, text, params);
  return inserted.id;
}
