import 'server-only';
// Stage 1b of the draft save: what the draft stores NOW, read inside the save's
// transaction AFTER `lockDraftProposal`, so no other save can change it before
// this one writes. Every column the save writes is read, so the write plan
// (./draft-save-diff) can tell an unchanged row from a changed one, and the F1
// cost rule reads the stored costs from the same rows.
import { proposalLines, proposalSections, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import type { ResolvedLine, ResolvedSection } from './draft-save-resolve';

/** A section's written columns (org and proposal are the save's own). */
export type WrittenSection = Omit<ResolvedSection, 'id' | 'lines' | 'subtotal'> & {
  sectionSubtotal: string;
};
/** A line's written columns (org and proposal are the save's own). */
export type WrittenLine = Omit<ResolvedLine, 'id'> & { sectionId: string };

export type StoredSectionRow = WrittenSection & { id: string };
export type StoredLineRow = WrittenLine & { id: string };

export interface StoredDraft {
  sections: Map<string, StoredSectionRow>;
  lines: Map<string, StoredLineRow>;
}

export async function loadStoredDraft(tx: MetraDb, proposalId: string): Promise<StoredDraft> {
  const sections: StoredSectionRow[] = await tx
    .select({
      id: proposalSections.id,
      titleAr: proposalSections.titleAr,
      titleEn: proposalSections.titleEn,
      sortOrder: proposalSections.sortOrder,
      sectionSubtotal: proposalSections.sectionSubtotal,
    })
    .from(proposalSections)
    .where(eq(proposalSections.proposalId, proposalId));
  const lines: StoredLineRow[] = await tx
    .select({
      id: proposalLines.id,
      sectionId: proposalLines.sectionId,
      costItemId: proposalLines.costItemId,
      descriptionAr: proposalLines.descriptionAr,
      descriptionEn: proposalLines.descriptionEn,
      qty: proposalLines.qty,
      unit: proposalLines.unit,
      unitCost: proposalLines.unitCost,
      unitPrice: proposalLines.unitPrice,
      discountPct: proposalLines.discountPct,
      lineCost: proposalLines.lineCost,
      lineTotal: proposalLines.lineTotal,
      lineMargin: proposalLines.lineMargin,
      sortOrder: proposalLines.sortOrder,
    })
    .from(proposalLines)
    .where(eq(proposalLines.proposalId, proposalId));
  return {
    sections: new Map(sections.map((section) => [section.id, section])),
    lines: new Map(lines.map((line) => [line.id, line])),
  };
}

/**
 * F1: this proposal's stored line costs by stable id. Without it, every save by
 * a cost-blind caller would silently reprice the document to zero cost.
 */
export function storedCostsById(stored: StoredDraft): Map<string, string> {
  return new Map([...stored.lines].map(([id, line]) => [id, line.unitCost]));
}
