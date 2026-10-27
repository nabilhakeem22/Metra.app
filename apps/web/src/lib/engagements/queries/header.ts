import 'server-only';
import { clientContacts, clients, designEngagements, projects, type DesignEngagementState, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { EntryPhase } from '@/lib/flow/types';
import type { ClientExpectedRecord } from '../client-expected-view';
import { entryPhaseOf } from './entry-phase';

/**
 * The engagement header for the detail surface. All money is returned as scale-4
 * strings (the UI applies 2-decimal formatting); timestamps as ISO strings so the
 * value crosses the server -> client boundary cleanly. Omits the client-share
 * token columns (`token_hash`/`share_expires_at`) — no internal surface needs
 * them. Null when the engagement does not resolve in-org. The CALLER gates the
 * read on the `engagements_design` read capability; RLS is the second factor.
 */
export interface EngagementHeader {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  clientId: string;
  projectId: string;
  clientNameEn: string | null;
  clientNameAr: string | null;
  projectNameEn: string | null;
  projectNameAr: string | null;
  state: DesignEngagementState;
  /** 'execution' for a LIGHT delivery: the client page of an execution contract, with no design behind it (ruling D14). */
  entryPhase: EntryPhase;
  designFee: string | null;
  offPlan: boolean;
  asBuiltDue: boolean;
  freeRevisionN: number;
  revisionCount: number;
  /**
   * The 3D revision pair, INDEPENDENT of the concept pair above: the cockpit's
   * revision form prices a `designChangeRaised` revision against these, so a
   * fully-burned concept allowance never costs the client a free 3D revision.
   */
  freeDesignRevisionN: number;
  designRevisionCount: number;
  romLow: string | null;
  romHigh: string | null;
  /** When the band was issued to the client; null while it is a draft. */
  romIssuedAt: Date | null;
  conceptLockedAt: string | null;
  renderManifestHash: string | null;
  rendersReadyAt: string | null;
  /** The date the client page promises for the next step (0058); null when unset. */
  clientExpected: ClientExpectedRecord | null;
  /**
   * Has the client an address a one-time code could go to: the database's own
   * rule (app_client_code_destination: the primary contact's email, else the
   * client's own, and it must look like an address). Only whether one exists
   * crosses this boundary, never the address.
   */
  clientHasEmail: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The header row in one statement: the engagement, its client and project names, and the email flag. */
async function readHeaderRow(tx: MetraDb, engagementId: string) {
  const [row] = await tx
    .select({
      id: designEngagements.id,
      number: designEngagements.number,
      titleAr: designEngagements.titleAr,
      titleEn: designEngagements.titleEn,
      clientId: designEngagements.clientId,
      projectId: designEngagements.projectId,
      clientNameEn: clients.nameEn,
      clientNameAr: clients.nameAr,
      projectNameEn: projects.nameEn,
      projectNameAr: projects.nameAr,
      state: designEngagements.state,
      entryPhase: designEngagements.entryPhase,
      designFee: designEngagements.designFee,
      offPlan: designEngagements.offPlan,
      asBuiltDue: designEngagements.asBuiltDue,
      freeRevisionN: designEngagements.freeRevisionN,
      revisionCount: designEngagements.revisionCount,
      freeDesignRevisionN: designEngagements.freeDesignRevisionN,
      designRevisionCount: designEngagements.designRevisionCount,
      romLow: designEngagements.romLow,
      romHigh: designEngagements.romHigh,
      romIssuedAt: designEngagements.romIssuedAt,
      conceptLockedAt: designEngagements.conceptLockedAt,
      renderManifestHash: designEngagements.renderManifestHash,
      rendersReadyAt: designEngagements.rendersReadyAt,
      clientExpectedOn: designEngagements.clientExpectedOn,
      clientExpectedState: designEngagements.clientExpectedState,
      clientExpectedSetAt: designEngagements.clientExpectedSetAt,
      // In this one statement, so the flag costs no round trip of its own.
      clientHasEmail: sql<boolean>`(
          lower(coalesce(
            (select nullif(btrim(${clientContacts.email}), '') from ${clientContacts}
              where ${clientContacts.orgId} = ${designEngagements.orgId}
                and ${clientContacts.clientId} = ${designEngagements.clientId}
                and ${clientContacts.isPrimary}
              limit 1),
            nullif(btrim(${clients.email}), '')
          )) ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:].]+$'
        ) is true`,
      createdAt: designEngagements.createdAt,
      updatedAt: designEngagements.updatedAt,
    })
    .from(designEngagements)
    .leftJoin(clients, eq(clients.id, designEngagements.clientId))
    .leftJoin(projects, eq(projects.id, designEngagements.projectId))
    .where(eq(designEngagements.id, engagementId))
    .limit(1);
  return row;
}

type HeaderRow = NonNullable<Awaited<ReturnType<typeof readHeaderRow>>>;

/** The header row as the detail surface reads it: one expected-date record, ISO timestamps. */
function engagementHeaderOf(row: HeaderRow): EngagementHeader {
  const { clientExpectedOn, clientExpectedState, clientExpectedSetAt, ...header } = row;
  return {
    ...header,
    entryPhase: entryPhaseOf(row.entryPhase),
    // All three or none (0058's CHECK); read as one record or null.
    clientExpected:
      clientExpectedOn && clientExpectedState && clientExpectedSetAt
        ? { on: clientExpectedOn, state: clientExpectedState, setAt: clientExpectedSetAt.toISOString() }
        : null,
    conceptLockedAt: row.conceptLockedAt?.toISOString() ?? null,
    rendersReadyAt: row.rendersReadyAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function getEngagementHeader(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementHeader | null> {
  return withOrgContext(ctx, async (tx) => {
    const row = await readHeaderRow(tx, engagementId);
    if (!row) return null;
    return engagementHeaderOf(row);
  });
}
