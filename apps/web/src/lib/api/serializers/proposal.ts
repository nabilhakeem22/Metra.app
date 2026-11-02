import type { ProposalDetail } from '@/lib/proposals/queries';
import { toApiMoney, toIso } from './shared';
import { serializeProposalSection, type PublicProposalSection } from './proposal-sections';

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

type ProposalFields = Omit<PublicProposal, 'sections' | 'total_cost' | 'total_margin'>;

/** The proposal's own fields; never cost or margin, which serializeProposal gates. */
function proposalFields(detail: ProposalDetail): ProposalFields {
  return {
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
  };
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
    ...proposalFields(detail),
    sections: detail.sections.map((s) => serializeProposalSection(s, costVisible)),
  };
  if (costVisible) {
    out.total_cost = toApiMoney(detail.totalCost);
    out.total_margin = toApiMoney(detail.totalMargin);
  }
  return out;
}
