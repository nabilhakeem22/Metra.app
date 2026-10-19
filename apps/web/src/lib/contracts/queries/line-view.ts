import 'server-only';
// The columns of a line as the contract page shows it, and the ONE order every
// contract line read uses: the opening window (./section-summaries.ts), the
// per-section pages (./section-lines.ts), the variation picker
// (./line-search.ts) and the PDF (./detail-sections.ts). So a line sits in the
// same place on the page and in print, ties in sort_order included.
//
// NO COST COLUMN IS HERE: unitCost, lineCost and lineMargin never leave the
// database on these reads, so there is no margin gate to forget.
import { contractLines, contractSections } from '@metra/db';
import { asc } from 'drizzle-orm';

/** The most lines one read returns. */
export const LINES_PAGE_SIZE = 50;

export const LINE_VIEW_COLUMNS = {
  id: contractLines.id,
  descriptionAr: contractLines.descriptionAr,
  descriptionEn: contractLines.descriptionEn,
  qty: contractLines.qty,
  unit: contractLines.unit,
  unitPrice: contractLines.unitPrice,
  lineTotal: contractLines.lineTotal,
} as const;

/** Document order: sections in order, then lines in order; ids break the ties. */
export const SECTION_ORDER = [asc(contractSections.sortOrder), asc(contractSections.id)] as const;
export const LINE_ORDER = [asc(contractLines.sortOrder), asc(contractLines.id)] as const;
