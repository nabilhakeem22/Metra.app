import type { ProposalDetail } from '@/lib/proposals/queries';
import { toApiMoney, toApiQty, toIso } from './shared';

/** Minimal row the list endpoint serializes (camelCase, from the API query). */
export interface ProposalSummaryRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: string;
  currency: string;
  total: string;
  issueDate: string | null;
  clientId: string;
  projectId: string;
  createdAt: string | Date;
}

export interface PublicProposalSummary {
  id: string;
  number: number;
  title_ar: string | null;
  title_en: string | null;
  status: string;
  currency: string;
  total: string;
  issue_date: string | null;
  client_id: string;
  project_id: string;
  created_at: string | null;
}

export function serializeProposalSummary(
  row: ProposalSummaryRow,
): PublicProposalSummary {
  return {
    id: row.id,
    number: row.number,
    title_ar: row.titleAr,
    title_en: row.titleEn,
    status: row.status,
    currency: row.currency,
    total: toApiMoney(row.total),
    issue_date: row.issueDate,
    client_id: row.clientId,
    project_id: row.projectId,
    created_at: toIso(row.createdAt),
  };
}

export interface PublicProposalLine {
  id: string;
  description_ar: string | null;
  description_en: string | null;
  cost_item_id: string | null;
  qty: string;
  unit: string;
  unit_price: string;
  discount_pct: string;
  line_total: string;
  sort_order: number;
  // Cost/margin — present ONLY when the key's role can see margin.
  unit_cost?: string;
  line_cost?: string;
  line_margin?: string;
}

export interface PublicProposalSection {
  id: string;
  title_ar: string | null;
  title_en: string | null;
  sort_order: number;
  section_subtotal: string;
  lines: PublicProposalLine[];
  section_cost?: string;
  section_margin?: string;
}

export interface PublicProposal extends PublicProposalSummary {
  expiry_date: string | null;
  version: number;
  supersedes_id: string | null;
  discount_pct: string;
  tax_rate: string;
  supervision_pct: string;
  subtotal: string;
  discount_amount: string;
  taxable_base: string;
  tax_amount: string;
  supervision_amount: string;
  notes_ar: string | null;
  notes_en: string | null;
  terms_ar: string | null;
  terms_en: string | null;
  sections: PublicProposalSection[];
  total_cost?: string;
  total_margin?: string;
}

/**
 * Serialize a full proposal. The upstream query already strips cost/margin when
 * the key cannot see margin; `costVisible` gates it again here so the public shape
 * never carries a cost key for a non-margin caller.
 */
export function serializeProposal(
  detail: ProposalDetail,
  costVisible: boolean,
): PublicProposal {
  const out: PublicProposal = {
    id: detail.id,
    number: detail.number,
    title_ar: detail.titleAr,
    title_en: detail.titleEn,
    status: detail.status,
    currency: detail.currency,
    total: toApiMoney(detail.total),
    issue_date: detail.issueDate,
    client_id: detail.clientId,
    project_id: detail.projectId,
    created_at: toIso(detail.createdAt),
    expiry_date: detail.expiryDate,
    version: detail.version,
    supersedes_id: detail.supersedesId,
    discount_pct: toApiMoney(detail.discountPct),
    tax_rate: toApiMoney(detail.taxRate),
    supervision_pct: toApiMoney(detail.supervisionPct),
    subtotal: toApiMoney(detail.subtotal),
    discount_amount: toApiMoney(detail.discountAmount),
    taxable_base: toApiMoney(detail.taxableBase),
    tax_amount: toApiMoney(detail.taxAmount),
    supervision_amount: toApiMoney(detail.supervisionAmount),
    notes_ar: detail.notesAr,
    notes_en: detail.notesEn,
    terms_ar: detail.termsAr,
    terms_en: detail.termsEn,
    sections: detail.sections.map((s) => {
      const lines: PublicProposalLine[] = s.lines.map((l) => {
        const line: PublicProposalLine = {
          id: l.id,
          description_ar: l.descriptionAr,
          description_en: l.descriptionEn,
          cost_item_id: l.costItemId,
          qty: toApiQty(l.qty),
          unit: l.unit,
          unit_price: toApiMoney(l.unitPrice),
          discount_pct: toApiMoney(l.discountPct),
          line_total: toApiMoney(l.lineTotal),
          sort_order: l.sortOrder,
        };
        if (costVisible) {
          line.unit_cost = toApiMoney(l.unitCost);
          line.line_cost = toApiMoney(l.lineCost);
          line.line_margin = toApiMoney(l.lineMargin);
        }
        return line;
      });
      const section: PublicProposalSection = {
        id: s.id,
        title_ar: s.titleAr,
        title_en: s.titleEn,
        sort_order: s.sortOrder,
        section_subtotal: toApiMoney(s.sectionSubtotal),
        lines,
      };
      if (costVisible) {
        section.section_cost = toApiMoney(s.sectionCost);
        section.section_margin = toApiMoney(s.sectionMargin);
      }
      return section;
    }),
  };
  if (costVisible) {
    out.total_cost = toApiMoney(detail.totalCost);
    out.total_margin = toApiMoney(detail.totalMargin);
  }
  return out;
}
