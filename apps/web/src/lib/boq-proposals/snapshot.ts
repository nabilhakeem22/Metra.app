import 'server-only';
import { boqs, designEngagements, proposals, type MetraDb } from '@metra/db';
import { eq, sql } from 'drizzle-orm';
import type { ActionCode } from '@/lib/actions/result';
import { MAX_BOQ_LINES } from '@/lib/boqs/core';
import {
  loadDocumentNames,
  projectHasLiveContractOnIssuedBoq,
  type DocumentNames,
} from '@/lib/boqs/issue';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { isTerminal } from '@/lib/engagements/states';
import { proposalRevision } from '@/lib/proposals/revision';
import { isUuid } from '@/lib/uuid';
import { countSendable } from './count';
import type { ProposalSourceSection } from './map';
import { findSentRevision, type SentBoq } from './sent-revision';
import { loadProposalSource } from './source';

/** Everything Send as BOQ reads BEFORE it renders, with no write lock held. */
export interface SendSnapshot {
  proposal: {
    id: string;
    /** `updated_at` as epoch MICROSECONDS, text from SQL (a Date has ms only). */
    revision: string;
    titleAr: string | null;
    titleEn: string | null;
    notesAr: string | null;
    notesEn: string | null;
    discountPct: string;
    currency: string;
  };
  engagement: { id: string; clientId: string; projectId: string };
  /** WITH cost: the server's copy, never sent to the browser. */
  source: ProposalSourceSection[];
  /** max(number) + 1, NOT locked. The commit re-allocates and must agree. */
  nextBoqNumber: number;
  /** The UTC year at snapshot time; the PDF prints it in the number. */
  renderYear: number;
  names: DocumentNames;
}

/** This revision was already sent: the BOQ it produced, and the delivery it
 *  went to (a replay still completes a BOQ step a failed first try left). */
export interface AlreadySent {
  alreadySent: SentBoq;
  engagementId: string;
}

/** The BOQ proposal's header, or null when it is missing, foreign or a quote. */
async function readBoqProposal(
  tx: MetraDb,
  proposalId: string,
): Promise<(SendSnapshot['proposal'] & { engagementId: string }) | null> {
  const [row] = await tx
    .select({
      id: proposals.id,
      kind: proposals.kind,
      engagementId: proposals.engagementId,
      revision: proposalRevision,
      titleAr: proposals.titleAr,
      titleEn: proposals.titleEn,
      notesAr: proposals.notesAr,
      notesEn: proposals.notesEn,
      discountPct: proposals.discountPct,
      currency: proposals.currency,
    })
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!row || row.kind !== 'boq' || !row.engagementId) return null;
  const { kind: _kind, engagementId, ...header } = row;
  return { ...header, engagementId };
}

/** The engagement the BOQ belongs to, or the refusal code. */
async function readActiveEngagement(
  tx: MetraDb,
  engagementId: string,
): Promise<SendSnapshot['engagement'] | ActionCode> {
  const [row] = await tx
    .select({
      id: designEngagements.id,
      clientId: designEngagements.clientId,
      projectId: designEngagements.projectId,
      state: designEngagements.state,
    })
    .from(designEngagements)
    .where(eq(designEngagements.id, engagementId))
    .limit(1);
  if (!row) return 'record_not_found';
  if (isTerminal(row.state)) return 'engagement_not_active';
  return { id: row.id, clientId: row.clientId, projectId: row.projectId };
}

async function peekNextBoqNumber(tx: MetraDb): Promise<number> {
  const [row] = await tx
    .select({ next: sql<number>`(coalesce(max(${boqs.number}), 0) + 1)::int` })
    .from(boqs);
  return Number(row?.next ?? 1);
}

/** The RLS reads, in one transaction, or the refusal code. */
function readSnapshotRows(
  ctx: OrgContext,
  proposalId: string,
): Promise<Omit<SendSnapshot, 'names' | 'renderYear'> | AlreadySent | ActionCode> {
  return withOrgContext(ctx, async (tx) => {
    const header = await readBoqProposal(tx, proposalId);
    if (!header) return 'record_not_found';
    const sent = await findSentRevision(tx, proposalId, header.revision);
    if (sent) return { alreadySent: sent, engagementId: header.engagementId };
    const engagement = await readActiveEngagement(tx, header.engagementId);
    if (typeof engagement === 'string') return engagement;
    // Before the render: the commit's supersede would refuse this after Chromium
    // ran and the file was stored (freeze.ts stays the race backstop).
    if (await projectHasLiveContractOnIssuedBoq(tx, engagement.projectId)) return 'boq_has_contract';
    const { engagementId: _linked, ...proposal } = header;
    return {
      proposal,
      engagement,
      source: await loadProposalSource(tx, proposalId, { includeCost: true }),
      nextBoqNumber: await peekNextBoqNumber(tx),
    };
  });
}

/**
 * Read everything Send as BOQ needs, outside any write transaction.
 * `record_not_found`: missing, another org's, or not a BOQ proposal; `malformed`:
 * an id that is no id.
 * `engagement_not_active`: the engagement is terminal.
 * `boq_has_contract`: a live contract stands on the project's issued BOQ.
 * `line_required` / `too_many_lines`: nothing, or too much, to send.
 * `invalid_qty`: a negative quantity, which a BOQ line cannot hold.
 * `alreadySent`: this exact revision is already out (a replayed send), so the
 * caller answers with that BOQ and renders nothing.
 */
export async function loadSendSnapshot(
  ctx: OrgContext,
  proposalId: string,
): Promise<SendSnapshot | AlreadySent | ActionCode> {
  if (!isUuid(proposalId)) return 'malformed';
  const rows = await readSnapshotRows(ctx, proposalId);
  if (typeof rows === 'string' || 'alreadySent' in rows) return rows;

  const { lineCount } = countSendable(rows.source);
  if (lineCount === 0) return 'line_required';
  if (lineCount > MAX_BOQ_LINES) return 'too_many_lines';
  // A negative quantity is a de-scope in a variation order, never a BOQ line
  // (`boq_lines_qty_non_negative`); refused here, before the render, by code.
  if (rows.source.some((section) => section.lines.some((line) => line.qty.startsWith('-')))) {
    return 'invalid_qty';
  }

  const names = await loadDocumentNames(ctx, rows.engagement);
  if (!names) return 'record_not_found';
  return { ...rows, names, renderYear: new Date().getUTCFullYear() };
}
