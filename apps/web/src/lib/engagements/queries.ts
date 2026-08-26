import 'server-only';
import {
  clients,
  designEngagements,
  engagementArtifacts,
  engagementChangeOrders,
  engagementEvents,
  engagementMilestones,
  engagementTransitions,
  paymentEvents,
  projects,
  type ChangeOrderStatus,
  type DesignEngagementState,
  type EngagementArtifactKind,
  type EngagementEventKind,
  type MilestoneBasis,
  type MilestoneKind,
  type PaymentEventKind,
} from '@metra/db';
import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { TERMINAL_STATES } from './states';

/**
 * One row of the engagements list: the header fields the list surface renders
 * plus the client/project names joined in for display. Newest first (highest
 * per-org `number`). The CALLER gates the read on the `engagements_design` read
 * capability; RLS scopes it to the caller's org.
 */
export interface EngagementListRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  clientId: string;
  projectId: string;
  state: DesignEngagementState;
  clientNameEn: string | null;
  clientNameAr: string | null;
  projectNameEn: string | null;
  projectNameAr: string | null;
  createdAt: string;
}

/** Org-scoped engagements, newest first (by per-org number descending). */
export function listEngagements(ctx: OrgContext): Promise<EngagementListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: designEngagements.id,
        number: designEngagements.number,
        titleAr: designEngagements.titleAr,
        titleEn: designEngagements.titleEn,
        clientId: designEngagements.clientId,
        projectId: designEngagements.projectId,
        state: designEngagements.state,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
        projectNameEn: projects.nameEn,
        projectNameAr: projects.nameAr,
        createdAt: designEngagements.createdAt,
      })
      .from(designEngagements)
      .leftJoin(clients, eq(clients.id, designEngagements.clientId))
      .leftJoin(projects, eq(projects.id, designEngagements.projectId))
      .orderBy(desc(designEngagements.number));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}

/**
 * The one Delivery a Project surface links to: its current DE (id + rendered-number
 * inputs + lifecycle state + bilingual title). This is the through-project entry
 * point (Slice C2) — a Project reaches its Delivery, so the surface can show
 * "Open delivery" (with the stage badge) or "Start delivery". Timestamps cross the
 * server -> client boundary as ISO strings. RLS scopes the read to the caller's org.
 */
export interface ProjectDeliverySummary {
  id: string;
  number: number;
  state: DesignEngagementState;
  titleAr: string | null;
  titleEn: string | null;
  createdAt: string;
}

/**
 * The Project's current Delivery, or null if it has none. A Project has at most one
 * ACTIVE (non-terminal) Delivery at a time (the one-delivery guard in
 * `createEngagementCore` enforces it), so the ACTIVE one is preferred when present;
 * otherwise the most-recent by per-org `number` (a project whose only Deliveries are
 * TERMINAL surfaces the newest closed one). Reads via
 * `design_engagements_org_project_idx`; RLS scopes it to the caller's org (a foreign
 * project reads as null). The CALLER gates the read on the `engagements_design` read
 * capability.
 */
export function getEngagementByProject(
  ctx: OrgContext,
  projectId: string,
): Promise<ProjectDeliverySummary | null> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: designEngagements.id,
        number: designEngagements.number,
        state: designEngagements.state,
        titleAr: designEngagements.titleAr,
        titleEn: designEngagements.titleEn,
        createdAt: designEngagements.createdAt,
      })
      .from(designEngagements)
      .where(eq(designEngagements.projectId, projectId))
      .orderBy(desc(designEngagements.number));

    // Rows are newest-first by per-org number, so the first non-terminal row is the
    // highest-numbered ACTIVE Delivery; falling back to rows[0] yields the newest
    // Delivery overall when every one is terminal.
    const current =
      rows.find((row) => !TERMINAL_STATES.has(row.state)) ?? rows[0] ?? null;
    if (!current) return null;
    return { ...current, createdAt: current.createdAt.toISOString() };
  });
}

/**
 * The current Delivery for EACH of many projects in ONE round-trip (Slice C4) — the
 * batch form of `getEngagementByProject`, for the client Projects tab where a per-row
 * read would be an N+1. One query (`where project_id in (...)`, ordered by project then
 * `number` descending), reduced per project with the SAME rule as
 * `getEngagementByProject`: the first NON-terminal delivery is the highest-numbered
 * ACTIVE one; falling back to the newest overall surfaces the latest closed one when
 * every delivery is terminal. Returns a map keyed by projectId with `null` for a
 * project that has no delivery in-org; empty input reads `{}`. Reads via
 * `design_engagements_org_project_idx`; RLS scopes it to the caller's org (a foreign
 * project is absent from the map). The CALLER gates the read on the `engagements_design`
 * read capability.
 */
export function getDeliveriesByProjects(
  ctx: OrgContext,
  projectIds: string[],
): Promise<Record<string, ProjectDeliverySummary | null>> {
  return withOrgContext(ctx, async (tx) => {
    const result: Record<string, ProjectDeliverySummary | null> = {};
    for (const projectId of projectIds) result[projectId] = null;
    if (projectIds.length === 0) return result;

    const rows = await tx
      .select({
        id: designEngagements.id,
        number: designEngagements.number,
        state: designEngagements.state,
        titleAr: designEngagements.titleAr,
        titleEn: designEngagements.titleEn,
        createdAt: designEngagements.createdAt,
        projectId: designEngagements.projectId,
      })
      .from(designEngagements)
      .where(inArray(designEngagements.projectId, projectIds))
      .orderBy(
        asc(designEngagements.projectId),
        desc(designEngagements.number),
      );

    // Rows are grouped by project, newest-first by per-org number within each group.
    // For each project the first NON-terminal row is its highest-numbered ACTIVE
    // delivery; if none is active, the first row seen for that project is the newest
    // overall (a fully-terminal project surfaces its latest closed one). Mirrors the
    // "active-preferred, else most-recent" logic in `getEngagementByProject`.
    for (const row of rows) {
      const existing = result[row.projectId];
      if (existing && !TERMINAL_STATES.has(existing.state)) continue;
      if (existing && TERMINAL_STATES.has(row.state)) continue;
      const { projectId, ...summary } = row;
      result[projectId] = { ...summary, createdAt: row.createdAt.toISOString() };
    }

    return result;
  });
}

/**
 * How many deliveries count toward a project's lifetime cap (Slice C2-hardening):
 * the number of NON-abandoned deliveries. Predicate is `state <> 'abandoned'`
 * (owner decision) — abandoned deliveries never count, so a project with 1 real +
 * N abandoned rows still reads 1 and can start its extension. The create-time cap
 * check (`createEngagementCore`) inlines the same predicate inside its own tx to
 * avoid a second round-trip; this query feeds the project delivery panel. RLS
 * scopes the read to the caller's org (a foreign project reads as 0). The CALLER
 * gates the read on the `engagements_design` read capability.
 */
export function countProjectDeliveries(
  ctx: OrgContext,
  projectId: string,
): Promise<number> {
  return withOrgContext(ctx, async (tx) => {
    const [{ value }] = await tx
      .select({ value: count() })
      .from(designEngagements)
      .where(
        and(
          eq(designEngagements.projectId, projectId),
          ne(designEngagements.state, 'abandoned'),
        ),
      );
    return value;
  });
}

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
  designFee: string | null;
  offPlan: boolean;
  asBuiltDue: boolean;
  freeRevisionN: number;
  revisionCount: number;
  romLow: string | null;
  romHigh: string | null;
  conceptLockedAt: string | null;
  renderManifestHash: string | null;
  rendersReadyAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getEngagementHeader(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementHeader | null> {
  return withOrgContext(ctx, async (tx) => {
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
        designFee: designEngagements.designFee,
        offPlan: designEngagements.offPlan,
        asBuiltDue: designEngagements.asBuiltDue,
        freeRevisionN: designEngagements.freeRevisionN,
        revisionCount: designEngagements.revisionCount,
        romLow: designEngagements.romLow,
        romHigh: designEngagements.romHigh,
        conceptLockedAt: designEngagements.conceptLockedAt,
        renderManifestHash: designEngagements.renderManifestHash,
        rendersReadyAt: designEngagements.rendersReadyAt,
        createdAt: designEngagements.createdAt,
        updatedAt: designEngagements.updatedAt,
      })
      .from(designEngagements)
      .leftJoin(clients, eq(clients.id, designEngagements.clientId))
      .leftJoin(projects, eq(projects.id, designEngagements.projectId))
      .where(eq(designEngagements.id, engagementId))
      .limit(1);

    if (!row) return null;
    return {
      ...row,
      conceptLockedAt: row.conceptLockedAt?.toISOString() ?? null,
      rendersReadyAt: row.rendersReadyAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/** One row of the append-only transition ledger (state moves), newest first. */
export interface EngagementTransitionRecord {
  id: string;
  trigger: string | null;
  fromState: DesignEngagementState | null;
  toState: DesignEngagementState | null;
  actorUserId: string | null;
  note: string | null;
  decidedAt: Date;
}

/**
 * The lifecycle transition ledger for an engagement, NEWEST FIRST. RLS scopes the
 * read to the caller's org (a foreign engagement reads as an empty list). Feeds
 * the detail timeline alongside the approvals events.
 */
export function getEngagementTransitions(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementTransitionRecord[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: engagementTransitions.id,
        trigger: engagementTransitions.trigger,
        fromState: engagementTransitions.fromState,
        toState: engagementTransitions.toState,
        actorUserId: engagementTransitions.actorUserId,
        note: engagementTransitions.note,
        decidedAt: engagementTransitions.decidedAt,
      })
      .from(engagementTransitions)
      .where(eq(engagementTransitions.engagementId, engagementId))
      .orderBy(
        desc(engagementTransitions.decidedAt),
        desc(engagementTransitions.createdAt),
      ),
  );
}

/** A single milestone in a fee schedule (money as a scale-4 string). */
export interface FeeScheduleMilestone {
  kind: MilestoneKind;
  basis: MilestoneBasis;
  value: string;
  sortOrder: number;
}

/**
 * The fee schedule for an engagement: the design fee plus its ordered milestones.
 * `designFee` is null until `submitDesignFee` has fired. All money is returned as
 * scale-4 strings — the API/UI layer applies 2-decimal formatting, not this query.
 * RLS scopes both reads to the caller's org (a foreign engagement reads as empty).
 */
export interface EngagementFeeSchedule {
  designFee: string | null;
  milestones: FeeScheduleMilestone[];
}

export function getEngagementFeeSchedule(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementFeeSchedule> {
  return withOrgContext(ctx, async (tx) => {
    const [engagement] = await tx
      .select({ designFee: designEngagements.designFee })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);

    const milestones = await tx
      .select({
        kind: engagementMilestones.kind,
        basis: engagementMilestones.basis,
        value: engagementMilestones.value,
        sortOrder: engagementMilestones.sortOrder,
      })
      .from(engagementMilestones)
      .where(eq(engagementMilestones.engagementId, engagementId))
      .orderBy(asc(engagementMilestones.sortOrder));

    return { designFee: engagement?.designFee ?? null, milestones };
  });
}

/**
 * The rough build-cost band (ROM) set on an engagement. Both values are scale-4
 * strings or null (unset until `setEngagementRom` has fired). The API/UI layer
 * applies 2-decimal formatting, not this query. RLS scopes the read to the
 * caller's org (a foreign engagement reads as `{ romLow: null, romHigh: null }`).
 */
export interface EngagementRom {
  romLow: string | null;
  romHigh: string | null;
}

export function getEngagementRom(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementRom> {
  return withOrgContext(ctx, async (tx) => {
    const [engagement] = await tx
      .select({
        romLow: designEngagements.romLow,
        romHigh: designEngagements.romHigh,
      })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);

    return {
      romLow: engagement?.romLow ?? null,
      romHigh: engagement?.romHigh ?? null,
    };
  });
}

/**
 * The approved-render baseline captured when `rendersReady` fired. Both are null
 * until the design_3d -> final_approval move: `renderManifestHash` is the sha256
 * over the sorted approved-render content-hash list, `rendersReadyAt` the moment it
 * was captured. RLS scopes the read to the caller's org (a foreign engagement reads
 * as `{ renderManifestHash: null, rendersReadyAt: null }`).
 */
export interface EngagementRenderManifest {
  renderManifestHash: string | null;
  rendersReadyAt: Date | null;
}

export function getEngagementRenderManifest(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementRenderManifest> {
  return withOrgContext(ctx, async (tx) => {
    const [engagement] = await tx
      .select({
        renderManifestHash: designEngagements.renderManifestHash,
        rendersReadyAt: designEngagements.rendersReadyAt,
      })
      .from(designEngagements)
      .where(eq(designEngagements.id, engagementId))
      .limit(1);

    return {
      renderManifestHash: engagement?.renderManifestHash ?? null,
      rendersReadyAt: engagement?.rendersReadyAt ?? null,
    };
  });
}

/** One row of the append-only payment ledger (money as a scale-4 string). */
export interface EngagementPayment {
  id: string;
  kind: PaymentEventKind;
  amount: string;
  method: string | null;
  reference: string | null;
  clearedAt: Date;
  note: string | null;
}

/**
 * The cleared payments recorded against an engagement, NEWEST FIRST. All money is
 * returned as scale-4 strings — the API/UI layer applies 2-decimal formatting,
 * not this query. RLS scopes the read to the caller's org (a foreign engagement
 * reads as an empty list).
 */
export function getEngagementPayments(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementPayment[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: paymentEvents.id,
        kind: paymentEvents.kind,
        amount: paymentEvents.amount,
        method: paymentEvents.method,
        reference: paymentEvents.reference,
        clearedAt: paymentEvents.clearedAt,
        note: paymentEvents.note,
      })
      .from(paymentEvents)
      .where(eq(paymentEvents.engagementId, engagementId))
      .orderBy(desc(paymentEvents.clearedAt), desc(paymentEvents.createdAt)),
  );
}

/** One recorded/attested artifact of an engagement. */
export interface EngagementArtifactRecord {
  id: string;
  kind: EngagementArtifactKind;
  fileId: string | null;
  contentHash: string | null;
  label: string | null;
  attestedBy: string;
  attestedAt: Date;
  note: string | null;
}

/**
 * The artifacts recorded against an engagement, NEWEST FIRST. RLS scopes the read
 * to the caller's org (a foreign engagement reads as an empty list).
 */
export function getEngagementArtifacts(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementArtifactRecord[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: engagementArtifacts.id,
        kind: engagementArtifacts.kind,
        fileId: engagementArtifacts.fileId,
        contentHash: engagementArtifacts.contentHash,
        label: engagementArtifacts.label,
        attestedBy: engagementArtifacts.attestedBy,
        attestedAt: engagementArtifacts.attestedAt,
        note: engagementArtifacts.note,
      })
      .from(engagementArtifacts)
      .where(eq(engagementArtifacts.engagementId, engagementId))
      .orderBy(
        desc(engagementArtifacts.attestedAt),
        desc(engagementArtifacts.createdAt),
      ),
  );
}

/** One recorded decision in the append-only engagement approvals ledger. */
export interface EngagementEventRecord {
  id: string;
  kind: EngagementEventKind;
  actorUserId: string | null;
  docHash: string | null;
  note: string | null;
  decidedAt: Date;
}

/**
 * The approvals-ledger events recorded against an engagement, NEWEST FIRST
 * (includes `rom_acknowledgement` rows). RLS scopes the read to the caller's org
 * (a foreign engagement reads as an empty list). Omits the tokenized-client-ack
 * columns (actor_name/ip/user_agent) and the `range_low/high` ROM snapshot — a
 * range-aware read can select those when a surface needs them.
 */
export function getEngagementEvents(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementEventRecord[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: engagementEvents.id,
        kind: engagementEvents.kind,
        actorUserId: engagementEvents.actorUserId,
        docHash: engagementEvents.docHash,
        note: engagementEvents.note,
        decidedAt: engagementEvents.decidedAt,
      })
      .from(engagementEvents)
      .where(eq(engagementEvents.engagementId, engagementId))
      .orderBy(
        desc(engagementEvents.decidedAt),
        desc(engagementEvents.createdAt),
      ),
  );
}

/** One design-fee change order raised on an engagement (money as scale-4 string). */
export interface EngagementChangeOrderRecord {
  id: string;
  amount: string;
  reason: string | null;
  status: ChangeOrderStatus;
  raisedByUserId: string;
  raisedAt: Date;
  settledAt: Date | null;
}

/**
 * The change orders raised against an engagement, NEWEST FIRST. `amount` is a
 * scale-4 string — the API/UI layer applies 2-decimal formatting, not this query.
 * RLS scopes the read to the caller's org (a foreign engagement reads as an empty
 * list).
 */
export function getEngagementChangeOrders(
  ctx: OrgContext,
  engagementId: string,
): Promise<EngagementChangeOrderRecord[]> {
  return withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: engagementChangeOrders.id,
        amount: engagementChangeOrders.amount,
        reason: engagementChangeOrders.reason,
        status: engagementChangeOrders.status,
        raisedByUserId: engagementChangeOrders.raisedByUserId,
        raisedAt: engagementChangeOrders.raisedAt,
        settledAt: engagementChangeOrders.settledAt,
      })
      .from(engagementChangeOrders)
      .where(eq(engagementChangeOrders.engagementId, engagementId))
      .orderBy(
        desc(engagementChangeOrders.raisedAt),
        desc(engagementChangeOrders.createdAt),
      ),
  );
}
