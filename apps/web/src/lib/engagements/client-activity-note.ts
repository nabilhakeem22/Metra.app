// Design-Engagement Machine — the cockpit's "what the client actually asked for"
// derivation. PURE and CLIENT-SAFE: no 'use client', no runtime `@metra/db` or
// server-only import (both imports below are `import type`, fully erased at
// compile time), no side effects. It re-projects the client-activity feed the
// page already loaded into the ONE note the studio needs while it revises.
//
// Only a CHANGE REQUEST carries actionable instructions — an approval's note is
// commentary and must never be surfaced as the brief for the next revision.
import type { EngagementEventKind } from '@metra/db';
import type { EngagementClientActivityRecord } from './queries/client-activity';

/**
 * The client-channel event kinds that carry a revision brief. Approvals and the
 * ROM/handoff acknowledgements are deliberately excluded — see the module note.
 */
export const CLIENT_CHANGE_REQUEST_KINDS: ReadonlySet<EngagementEventKind> =
  new Set<EngagementEventKind>(['concept_change_request', 'design_change_request']);

/** The one client change-request note the command card surfaces. */
export interface ClientChangeRequestNote {
  kind: EngagementEventKind;
  /** The client's text, already trimmed and guaranteed non-empty. */
  note: string;
  /** The free-text name the client optionally entered on the portal. */
  actorName: string | null;
  decidedAt: Date;
}

/** Epoch ms for ordering; an unparseable timestamp sorts oldest, never wins. */
function decidedAtTime(decidedAt: Date): number {
  const time = new Date(decidedAt).getTime();
  return Number.isNaN(time) ? -Infinity : time;
}

/**
 * The MOST RECENT client change request that actually says something — the
 * newest entry (by `decidedAt`) whose kind is a change-request kind AND whose
 * note is non-empty after trimming. Returns null when there is none: an empty
 * feed, change requests filed with no note (or whitespace only), or a feed of
 * approvals — an approval's note is NEVER returned even if it has one.
 *
 * Ties on `decidedAt` resolve to the entry that comes FIRST in the input, which
 * preserves the query's own newest-first ordering (`decided_at DESC,
 * created_at DESC`) rather than re-guessing it here.
 */
export function findLatestClientChangeRequestNote(
  clientActivity: readonly EngagementClientActivityRecord[],
): ClientChangeRequestNote | null {
  let latest: ClientChangeRequestNote | null = null;
  let latestTime = -Infinity;

  for (const entry of clientActivity) {
    if (!CLIENT_CHANGE_REQUEST_KINDS.has(entry.kind)) continue;
    const note = entry.note?.trim();
    if (!note) continue;

    const time = decidedAtTime(entry.decidedAt);
    if (latest !== null && time <= latestTime) continue;

    latest = {
      kind: entry.kind,
      note,
      actorName: entry.actorName,
      decidedAt: entry.decidedAt,
    };
    latestTime = time;
  }

  return latest;
}
