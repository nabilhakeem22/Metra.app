// Client-safe canonical role list for the web app. Mirrors the Postgres
// `member_role` enum order (@metra/db) — the ordering contract is verified by
// permissions.test.ts (TS) and schema.test.ts (DB). Kept free of any @metra/db
// value import so client bundles never pull the server-only db/postgres layer.
export const MEMBER_ROLES = [
  'owner',
  'admin',
  'project_manager',
  'site_engineer',
  'accountant',
  'client',
  'viewer',
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];
