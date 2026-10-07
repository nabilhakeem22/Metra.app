// The proposal input shapes the builder posts and the cores read.
//
// PURE TYPES ONLY — no `server-only`, no runtime value, nothing to execute. They
// live apart from ./create.ts because every stage of the save (validate, resolve,
// persist) needs them and none of those stages needs proposal creation.
import type { CostItemUnit } from '@metra/db';

export interface CreateProposalInput {
  clientId: string;
  projectId: string;
  titleAr?: string | null;
  titleEn?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
}

export interface LineInput {
  /** Stable identity of an EXISTING line (round-tripped by the builder) so its
   * stored cost is preserved on save. Absent/unknown -> treated as a new line. */
  id?: string | null;
  costItemId?: string | null;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  qty?: string | null;
  unit?: CostItemUnit | null;
  unitCost?: string | null;
  unitPrice?: string | null;
  discountPct?: string | null;
  sortOrder?: number;
}

export interface SectionInput {
  id?: string;
  titleAr?: string | null;
  titleEn?: string | null;
  sortOrder?: number;
  lines: LineInput[];
}

export interface SaveDraftInput {
  id: string;
  /**
   * The revision token the caller last loaded or saved (../revision.ts). When
   * given and no longer current, the save is refused `draft_changed_elsewhere`:
   * another tab or user saved in between, and this save would overwrite them.
   * Omitted: no check (callers that hold no revision).
   */
  revision?: string;
  header?: {
    titleAr?: string | null;
    titleEn?: string | null;
    issueDate?: string | null;
    expiryDate?: string | null;
    discountPct?: string | null;
    taxRate?: string | null;
    supervisionPct?: string | null;
    currency?: string | null;
    notesAr?: string | null;
    notesEn?: string | null;
    termsAr?: string | null;
    termsEn?: string | null;
  };
  sections: SectionInput[];
}

/**
 * What a draft save stored, in the order it was sent: each section's id and its
 * lines' ids (a kept id, or the one the server gave a new line), and the new
 * revision. The builder adopts these so its next save names stored lines.
 */
export interface DraftSaveReceipt {
  revision: string;
  sections: { id: string; lineIds: string[] }[];
}
