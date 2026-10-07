// A proposal's REVISION token: `updated_at` as epoch microseconds, in text. Every
// draft save stamps `updated_at = clock_timestamp()`, so the token changes on
// every save and on nothing else while the proposal is a draft. Compared as text,
// never as a Date (a Date has only milliseconds).
//
// Two readers: Send as BOQ fences the BOQ it cuts on it (boq-proposals), and the
// builder sends the token it last loaded or saved so a save made from a stale tab
// is refused instead of silently overwriting another tab's edits.
import { proposals } from '@metra/db';
import { sql } from 'drizzle-orm';

export const proposalRevision = sql<string>`(extract(epoch from ${proposals.updatedAt}) * 1000000)::bigint::text`;

/** A well-formed revision token (what `proposalRevision` produces). */
export function isRevisionToken(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,20}$/.test(value);
}
