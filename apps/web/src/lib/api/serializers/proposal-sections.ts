import type { ProposalDetail } from '@/lib/proposals/queries';
import { toApiMoney, toApiQty } from './shared';

type DetailSection = ProposalDetail['sections'][number];
type DetailLine = DetailSection['lines'][number];

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

export function serializeProposalLine(l: DetailLine, costVisible: boolean): PublicProposalLine {
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
}

export function serializeProposalSection(s: DetailSection, costVisible: boolean): PublicProposalSection {
  const lines: PublicProposalLine[] = s.lines.map((l) => serializeProposalLine(l, costVisible));
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
}
