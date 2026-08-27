import 'server-only';
import { engagementEvents, type EngagementEventKind } from '@metra/db';
import { and, desc, eq } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';

/**
 * One client-channel signal the studio sees in the cockpit: the client's own
 * approval / change-request / acknowledgement, recorded via the delivery portal
 * token path (`actor_channel = 'client'`). `rangeLow`/`rangeHigh` carry the ROM
 * band snapshot for a `rom_acknowledgement`; `actorName` is the free-text name the
 * client optionally entered. No cost/margin — these are advisory client signals.
 */
export interface EngagementClientActivityRecord {
  kind: EngagementEventKind;
  actorName: string | null;
  note: string | null;
  rangeLow: string | null;
  rangeHigh: string | null;
  decidedAt: Date;
}

/**
 * The CLIENT-CHANNEL events recorded against an engagement, NEWEST FIRST — the
 * cockpit's "Client activity" feed. Gated on the §2.2 `engagements_design` read
 * cell (a role without it reads an empty list, mirroring the page guard). RLS
 * scopes the read to the caller's org, so a foreign engagement also reads empty.
 * Filters to `actor_channel = 'client'`, so staff-recorded events never appear.
 */
export function getEngagementClientActivity(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementClientActivityRecord[]> {
  if (!can(ctx.role, 'engagements_design', 'read')) return Promise.resolve([]);
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        kind: engagementEvents.kind,
        actorName: engagementEvents.actorName,
        note: engagementEvents.note,
        rangeLow: engagementEvents.rangeLow,
        rangeHigh: engagementEvents.rangeHigh,
        decidedAt: engagementEvents.decidedAt,
      })
      .from(engagementEvents)
      .where(
        and(
          eq(engagementEvents.engagementId, engagementId),
          eq(engagementEvents.actorChannel, 'client'),
        ),
      )
      .orderBy(
        desc(engagementEvents.decidedAt),
        desc(engagementEvents.createdAt),
      ),
  );
}
