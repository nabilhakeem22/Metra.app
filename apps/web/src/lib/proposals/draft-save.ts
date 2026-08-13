// Draft save (the heaviest proposal core): recompute EVERY total from the money
// engine, never trust a client-supplied subtotal/total, F1-preserve stored costs
// by stable line id. Decomposed into header validation, line resolution, and
// persistence around a thin orchestrator. Draft-only (proposal_not_draft).
import {
  costItems,
  organizations,
  proposalLines,
  proposalSections,
  proposals,
  type CostItemUnit,
  type MetraDb,
} from '@metra/db';
import { eq, inArray } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import type { ActionResult } from '@/lib/actions/result';
import {
  computeLine,
  computeSection,
  computeTotals,
  type LineTotals,
  type SectionTotals,
} from '@/lib/aggregates/proposal-totals';
import type { OrgContext } from '@/lib/db/context';
import { canSeeMargin } from '@/lib/permissions/can';
import {
  chunk,
  LINE_INSERT_CHUNK,
  MAX_LINES_PER_SECTION,
  MAX_SECTIONS,
  MAX_TOTAL_LINES,
  normalizeMoney,
  normalizeText,
  pctInRange,
  validIsoDate,
  withinMagnitude,
  type SaveDraftInput,
  type SectionInput,
} from './core';

type ProposalRow = typeof proposals.$inferSelect;
type DraftHeader = NonNullable<SaveDraftInput['header']>;

interface CostItemResolved {
  unit: CostItemUnit;
  defaultUnitCost: string;
  defaultUnitPrice: string;
  nameEn: string | null;
  nameAr: string | null;
}

interface ResolvedLine {
  costItemId: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
  qty: string;
  unit: CostItemUnit;
  unitCost: string;
  unitPrice: string;
  discountPct: string;
  lineCost: string;
  lineTotal: string;
  lineMargin: string;
  sortOrder: number;
}

interface ResolvedSection {
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  subtotal: string;
  lines: ResolvedLine[];
}

interface ResolvedHeader {
  discountPct: string;
  taxRate: string;
  supervisionPct: string;
  titleEn: string | null;
  titleAr: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  currency: string;
  notesAr: string | null;
  notesEn: string | null;
  termsAr: string | null;
  termsEn: string | null;
}

/** Validate + normalize the header against the proposal's current values. */
function validateDraftHeader(
  proposal: ProposalRow,
  header: DraftHeader,
): ResolvedHeader {
  const discountPct = normalizeMoney(header.discountPct, proposal.discountPct);
  const taxRate = normalizeMoney(header.taxRate, proposal.taxRate);
  const supervisionPct = normalizeMoney(
    header.supervisionPct,
    proposal.supervisionPct,
  );
  if (discountPct === null || taxRate === null || supervisionPct === null) {
    fail('invalid');
  }
  if (!pctInRange(discountPct!)) fail('discount_out_of_range');
  if (!pctInRange(supervisionPct!)) fail('supervision_out_of_range');
  const titleEn =
    header.titleEn !== undefined ? normalizeText(header.titleEn) : proposal.titleEn;
  const titleAr =
    header.titleAr !== undefined ? normalizeText(header.titleAr) : proposal.titleAr;
  if (!titleEn && !titleAr) fail('name_required');

  const issueDate =
    header.issueDate !== undefined
      ? normalizeText(header.issueDate)
      : proposal.issueDate;
  const expiryDate =
    header.expiryDate !== undefined
      ? normalizeText(header.expiryDate)
      : proposal.expiryDate;
  if (issueDate && !validIsoDate(issueDate)) fail('invalid_date');
  if (expiryDate && !validIsoDate(expiryDate)) fail('invalid_date');

  return {
    discountPct: discountPct!,
    taxRate: taxRate!,
    supervisionPct: supervisionPct!,
    titleEn,
    titleAr,
    issueDate,
    expiryDate,
    currency: normalizeText(header.currency) ?? proposal.currency,
    notesAr:
      header.notesAr !== undefined ? normalizeText(header.notesAr) : proposal.notesAr,
    notesEn:
      header.notesEn !== undefined ? normalizeText(header.notesEn) : proposal.notesEn,
    termsAr:
      header.termsAr !== undefined ? normalizeText(header.termsAr) : proposal.termsAr,
    termsEn:
      header.termsEn !== undefined ? normalizeText(header.termsEn) : proposal.termsEn,
  };
}

/** R2 boundary caps — reject oversized payloads before doing any work. */
function enforceLineCaps(sections: SectionInput[]): void {
  if (sections.length > MAX_SECTIONS) fail('too_many_lines');
  let totalLines = 0;
  for (const section of sections) {
    if (section.lines.length > MAX_LINES_PER_SECTION) fail('too_many_lines');
    totalLines += section.lines.length;
  }
  if (totalLines > MAX_TOTAL_LINES) fail('too_many_lines');
}

/** One lookup for every referenced cost item; validates each exists + is active. */
async function loadCostItemMap(
  tx: MetraDb,
  sections: SectionInput[],
): Promise<Map<string, CostItemResolved>> {
  const costItemIds = [
    ...new Set(
      sections.flatMap((section) =>
        section.lines
          .map((line) => line.costItemId?.trim())
          .filter((id): id is string => !!id),
      ),
    ),
  ];
  const costItemMap = new Map<string, CostItemResolved>();
  if (costItemIds.length) {
    const costItemRows = await tx
      .select()
      .from(costItems)
      .where(inArray(costItems.id, costItemIds));
    for (const costItem of costItemRows) {
      if (!costItem.active) fail('invalid');
      costItemMap.set(costItem.id, costItem);
    }
    for (const costItemId of costItemIds) {
      if (!costItemMap.has(costItemId)) fail('invalid');
    }
  }
  return costItemMap;
}

/**
 * Resolve every section + line in memory (cost by F1 stable-id rule, price/unit
 * from the line or the price book), computing each line + section total. Pure
 * (no DB) — the caller batches the writes afterwards.
 */
function resolveDraftLines(
  sections: SectionInput[],
  costItemMap: Map<string, CostItemResolved>,
  costSnapshot: Map<string, string>,
  seeMargin: boolean,
): { resolvedSections: ResolvedSection[]; sectionTotals: SectionTotals[] } {
  const resolvedSections: ResolvedSection[] = [];
  const sectionTotals: SectionTotals[] = [];

  for (const [sectionIndex, section] of sections.entries()) {
    const sectionTitleEn = normalizeText(section.titleEn);
    const sectionTitleAr = normalizeText(section.titleAr);
    if (!sectionTitleEn && !sectionTitleAr) fail('name_required');

    const lineTotals: LineTotals[] = [];
    const lines: ResolvedLine[] = [];
    for (const [lineIndex, line] of section.lines.entries()) {
      const costItemId = line.costItemId?.trim() || null;
      const costItem = costItemId ? costItemMap.get(costItemId) : undefined;
      const resolvedUnit = line.unit ?? costItem?.unit ?? null;
      const resolvedUnitPrice =
        line.unitPrice ?? costItem?.defaultUnitPrice ?? null;
      const descriptionEn =
        normalizeText(line.descriptionEn) ?? costItem?.nameEn ?? null;
      const descriptionAr =
        normalizeText(line.descriptionAr) ?? costItem?.nameAr ?? null;

      // F1 cost resolution by stable identity.
      const lineId = line.id?.trim() || null;
      const isExisting = !!lineId && costSnapshot.has(lineId);
      let rawCost: string | null;
      if (isExisting) {
        rawCost = seeMargin
          ? (line.unitCost ?? costSnapshot.get(lineId!)!)
          : costSnapshot.get(lineId!)!;
      } else {
        rawCost = costItemId
          ? costItem!.defaultUnitCost
          : seeMargin
            ? line.unitCost || '0'
            : '0';
      }

      const qty = normalizeMoney(line.qty);
      const unitCost = normalizeMoney(rawCost);
      const unitPrice = normalizeMoney(resolvedUnitPrice);
      const discountPct = normalizeMoney(line.discountPct);
      if (
        qty === null ||
        unitCost === null ||
        unitPrice === null ||
        discountPct === null ||
        !resolvedUnit ||
        (!descriptionEn && !descriptionAr)
      ) {
        fail('line_required');
      }
      if (
        !withinMagnitude(qty!) ||
        !withinMagnitude(unitCost!) ||
        !withinMagnitude(unitPrice!)
      ) {
        fail('amount_too_large');
      }
      if (!pctInRange(discountPct!)) fail('discount_out_of_range');

      const totals = computeLine({
        qty: qty!,
        unitCost: unitCost!,
        unitPrice: unitPrice!,
        discountPct: discountPct!,
      });
      lineTotals.push(totals);
      lines.push({
        costItemId,
        descriptionAr,
        descriptionEn,
        qty: qty!,
        unit: resolvedUnit!,
        unitCost: unitCost!,
        unitPrice: unitPrice!,
        discountPct: discountPct!,
        lineCost: totals.lineCost,
        lineTotal: totals.lineTotal,
        lineMargin: totals.lineMargin,
        sortOrder: line.sortOrder ?? lineIndex,
      });
    }
    const sectionSubtotals = computeSection(lineTotals);
    sectionTotals.push(sectionSubtotals);
    resolvedSections.push({
      titleAr: sectionTitleAr,
      titleEn: sectionTitleEn,
      sortOrder: section.sortOrder ?? sectionIndex,
      subtotal: sectionSubtotals.sectionSubtotal,
      lines,
    });
  }

  return { resolvedSections, sectionTotals };
}

/** Batch-insert the resolved sections (subtotal precomputed) then all lines. */
async function persistDraftSectionsAndLines(
  tx: MetraDb,
  orgId: string,
  proposalId: string,
  resolvedSections: ResolvedSection[],
): Promise<void> {
  if (!resolvedSections.length) return;
  const sectionRows = await tx
    .insert(proposalSections)
    .values(
      resolvedSections.map((section) => ({
        orgId,
        proposalId,
        titleAr: section.titleAr,
        titleEn: section.titleEn,
        sortOrder: section.sortOrder,
        sectionSubtotal: section.subtotal,
      })),
    )
    .returning({ id: proposalSections.id });

  const lineRows = resolvedSections.flatMap((section, index) =>
    section.lines.map((line) => ({
      orgId,
      proposalId,
      sectionId: sectionRows[index].id,
      ...line,
    })),
  );
  for (const part of chunk(lineRows, LINE_INSERT_CHUNK)) {
    await tx.insert(proposalLines).values(part);
  }
}

export async function saveProposalDraftCore(
  ctx: OrgContext,
  input: SaveDraftInput,
): Promise<ActionResult> {
  return mutateInOrg(
    ctx,
    { capability: 'proposals_build', action: 'update' },
    async (tx, audit) => {
      const [proposal] = await tx
        .select()
        .from(proposals)
        .where(eq(proposals.id, input.id))
        .limit(1);
      if (!proposal) fail('invalid');
      if (proposal.status !== 'draft') fail('proposal_not_draft');

      // Cost-visibility is org+role scoped: only margin-visible callers may
      // change a cost. (Loaded inside the txn under RLS.)
      const [orgRow] = await tx
        .select({ hide: organizations.hideMarginFromPm })
        .from(organizations)
        .limit(1);
      const seeMargin = canSeeMargin(ctx.role, orgRow?.hide ?? true);

      const header = validateDraftHeader(proposal, input.header ?? {});
      enforceLineCaps(input.sections);

      // F1: snapshot this proposal's current line costs by stable id (BEFORE the
      // rebuild delete wipes them).
      const existingLines = await tx
        .select({ id: proposalLines.id, unitCost: proposalLines.unitCost })
        .from(proposalLines)
        .where(eq(proposalLines.proposalId, input.id));
      const costSnapshot = new Map(
        existingLines.map((line) => [line.id, line.unitCost]),
      );

      const costItemMap = await loadCostItemMap(tx, input.sections);

      // Rebuild sections + lines from scratch (cascade wipes old lines).
      await tx
        .delete(proposalSections)
        .where(eq(proposalSections.proposalId, input.id));

      const { resolvedSections, sectionTotals } = resolveDraftLines(
        input.sections,
        costItemMap,
        costSnapshot,
        seeMargin,
      );
      await persistDraftSectionsAndLines(
        tx,
        ctx.orgId,
        input.id,
        resolvedSections,
      );

      const totals = computeTotals(sectionTotals, {
        discountPct: header.discountPct,
        taxRate: header.taxRate,
        supervisionPct: header.supervisionPct,
      });

      await tx
        .update(proposals)
        .set({
          titleAr: header.titleAr,
          titleEn: header.titleEn,
          issueDate: header.issueDate,
          expiryDate: header.expiryDate,
          currency: header.currency,
          notesAr: header.notesAr,
          notesEn: header.notesEn,
          termsAr: header.termsAr,
          termsEn: header.termsEn,
          discountPct: header.discountPct,
          taxRate: header.taxRate,
          supervisionPct: header.supervisionPct,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          taxableBase: totals.taxableBase,
          taxAmount: totals.taxAmount,
          supervisionAmount: totals.supervisionAmount,
          total: totals.total,
          totalCost: totals.totalCost,
          totalMargin: totals.totalMargin,
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, input.id));

      await audit({
        entity: 'proposal',
        entityId: input.id,
        action: 'update',
        before: null,
        after: { sections: input.sections.length, total: totals.total },
      });
    },
  );
}
