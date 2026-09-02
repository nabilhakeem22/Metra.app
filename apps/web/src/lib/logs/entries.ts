// One entry in an entity's Logs feed — PURE and CLIENT-SAFE: no db import, no
// `server-only`, no 'use client'.
//
// The Logs tab shows TWO sources that answer different questions, merged into one
// timeline: the activity feed (what people said and what the product announced) and
// the audit log (who changed what, and when). Neither alone is "the log" a firm
// means when they ask for one — a note without the record of the edit that followed
// it is gossip, and an audit row without the note is a diff with no reason.
//
// The merge shape lives here, apart from either reader, so the two never grow
// incompatible ideas of what an entry is.

export type LogSource = 'activity' | 'audit';

export interface LogEntry {
  /** Unique across BOTH sources — prefixed, because an activity id and an audit id
   *  could otherwise collide as React keys. */
  id: string;
  source: LogSource;
  at: string;
  /** The acting user, or null for a system event / a client acting by token. */
  actorUserId: string | null;
  /**
   * What happened, as a translation key suffix the tab resolves:
   *  - activity: the activity `kind` (note, client_created, proposal_sent, …)
   *  - audit:    `<entity>.<action>` (e.g. `client.update`)
   * Never a pre-built sentence — the tab is bilingual and RTL.
   */
  labelKey: string;
  /** The note body, for a user-written activity. Null for everything else. */
  note: string | null;
}

/**
 * Merge the two sources into one newest-first timeline, capped.
 *
 * Sorting is by timestamp DESCENDING with the source as a stable tiebreak, so an
 * audit row and the activity row written in the same transaction (a create writes
 * both) land in a deterministic order rather than shuffling between renders.
 * Activity wins the tie: it carries the human sentence, and it reads better above
 * the machine record of the same moment.
 */
export function mergeLogEntries(
  activity: readonly LogEntry[],
  audit: readonly LogEntry[],
  limit = 50,
): LogEntry[] {
  return [...activity, ...audit]
    .sort((a, b) => {
      const byTime = Date.parse(b.at) - Date.parse(a.at);
      if (byTime !== 0) return byTime;
      if (a.source === b.source) return a.id < b.id ? 1 : -1;
      return a.source === 'activity' ? -1 : 1;
    })
    .slice(0, limit);
}
