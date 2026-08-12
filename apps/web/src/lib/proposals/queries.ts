import 'server-only';
import {
  clients,
  projects,
  proposalLines,
  proposalSections,
  proposals,
  type ProposalStatus,
} from '@metra/db';
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import {
  computeSection,
  type LineTotals,
} from '@/lib/aggregates/proposal-totals';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ProposalListRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: ProposalStatus;
  total: string;
  currency: string;
  issueDate: string | null;
  createdAt: string;
  clientNameEn: string | null;
  clientNameAr: string | null;
  projectNameEn: string | null;
  projectNameAr: string | null;
}

export interface ListProposalsFilter {
  status?: ProposalStatus;
  projectId?: string;
  clientId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

// R5: always bounded — never stream an unbounded proposal set.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export function listProposals(
  ctx: OrgContext,
  filter: ListProposalsFilter = {},
): Promise<ProposalListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const conds = [];
    if (filter.status) conds.push(eq(proposals.status, filter.status));
    if (filter.projectId) conds.push(eq(proposals.projectId, filter.projectId));
    if (filter.clientId) conds.push(eq(proposals.clientId, filter.clientId));
    if (filter.q && filter.q.trim()) {
      const p = `%${filter.q.trim()}%`;
      conds.push(or(ilike(proposals.titleEn, p), ilike(proposals.titleAr, p)));
    }
    const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = await tx
      .select({
        id: proposals.id,
        number: proposals.number,
        titleAr: proposals.titleAr,
        titleEn: proposals.titleEn,
        status: proposals.status,
        total: proposals.total,
        currency: proposals.currency,
        issueDate: proposals.issueDate,
        createdAt: proposals.createdAt,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
        projectNameEn: projects.nameEn,
        projectNameAr: projects.nameAr,
      })
      .from(proposals)
      .leftJoin(clients, eq(clients.id, proposals.clientId))
      .leftJoin(projects, eq(projects.id, proposals.projectId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(proposals.number))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}

export interface ProposalDetailLine {
  id: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  costItemId: string | null;
  qty: string;
  unit: string;
  unitPrice: string;
  discountPct: string;
  lineTotal: string;
  sortOrder: number;
  // margin-gated
  unitCost?: string;
  lineCost?: string;
  lineMargin?: string;
}

export interface ProposalDetailSection {
  id: string;
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  sectionSubtotal: string;
  lines: ProposalDetailLine[];
  // margin-gated
  sectionCost?: string;
  sectionMargin?: string;
}

export interface ProposalDetail {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: ProposalStatus;
  currency: string;
  issueDate: string | null;
  expiryDate: string | null;
  createdAt: string;
  version: number;
  supersedesId: string | null;
  clientId: string;
  projectId: string;
  clientNameEn: string | null;
  clientNameAr: string | null;
  discountPct: string;
  taxRate: string;
  supervisionPct: string;
  subtotal: string;
  discountAmount: string;
  taxableBase: string;
  taxAmount: string;
  supervisionAmount: string;
  total: string;
  notesAr: string | null;
  notesEn: string | null;
  termsAr: string | null;
  termsEn: string | null;
  sections: ProposalDetailSection[];
  // margin-gated
  totalCost?: string;
  totalMargin?: string;
}

async function loadDetail(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ProposalDetail | null> {
  return withOrgContext(ctx, async (tx) => {
    const [p] = await tx
      .select({
        id: proposals.id,
        number: proposals.number,
        titleAr: proposals.titleAr,
        titleEn: proposals.titleEn,
        status: proposals.status,
        currency: proposals.currency,
        issueDate: proposals.issueDate,
        expiryDate: proposals.expiryDate,
        createdAt: proposals.createdAt,
        version: proposals.version,
        supersedesId: proposals.supersedesId,
        clientId: proposals.clientId,
        projectId: proposals.projectId,
        discountPct: proposals.discountPct,
        taxRate: proposals.taxRate,
        supervisionPct: proposals.supervisionPct,
        subtotal: proposals.subtotal,
        discountAmount: proposals.discountAmount,
        taxableBase: proposals.taxableBase,
        taxAmount: proposals.taxAmount,
        supervisionAmount: proposals.supervisionAmount,
        total: proposals.total,
        totalCost: proposals.totalCost,
        totalMargin: proposals.totalMargin,
        notesAr: proposals.notesAr,
        notesEn: proposals.notesEn,
        termsAr: proposals.termsAr,
        termsEn: proposals.termsEn,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
      })
      .from(proposals)
      .leftJoin(clients, eq(clients.id, proposals.clientId))
      .where(eq(proposals.id, id))
      .limit(1);
    if (!p) return null;

    const secs = await tx
      .select()
      .from(proposalSections)
      .where(eq(proposalSections.proposalId, id))
      .orderBy(asc(proposalSections.sortOrder));
    const allLines = await tx
      .select()
      .from(proposalLines)
      .where(eq(proposalLines.proposalId, id))
      .orderBy(asc(proposalLines.sortOrder));

    // R5: group lines by section once (avoids an O(sections*lines) nested filter).
    const linesBySection = new Map<string, typeof allLines>();
    for (const l of allLines) {
      const arr = linesBySection.get(l.sectionId);
      if (arr) arr.push(l);
      else linesBySection.set(l.sectionId, [l]);
    }

    const sections: ProposalDetailSection[] = secs.map((s) => {
      const secLines = linesBySection.get(s.id) ?? [];
      const lines: ProposalDetailLine[] = secLines.map((l) => {
        const base: ProposalDetailLine = {
          id: l.id,
          descriptionAr: l.descriptionAr,
          descriptionEn: l.descriptionEn,
          costItemId: l.costItemId,
          qty: l.qty,
          unit: l.unit,
          unitPrice: l.unitPrice,
          discountPct: l.discountPct,
          lineTotal: l.lineTotal,
          sortOrder: l.sortOrder,
        };
        if (canSeeMargin) {
          base.unitCost = l.unitCost;
          base.lineCost = l.lineCost;
          base.lineMargin = l.lineMargin;
        }
        return base;
      });
      const section: ProposalDetailSection = {
        id: s.id,
        titleAr: s.titleAr,
        titleEn: s.titleEn,
        sortOrder: s.sortOrder,
        sectionSubtotal: s.sectionSubtotal,
        lines,
      };
      if (canSeeMargin) {
        const totals = computeSection(
          secLines.map(
            (l): LineTotals => ({
              lineCost: l.lineCost,
              lineTotal: l.lineTotal,
              lineMargin: l.lineMargin,
            }),
          ),
        );
        section.sectionCost = totals.sectionCost;
        section.sectionMargin = totals.sectionMargin;
      }
      return section;
    });

    const detail: ProposalDetail = {
      id: p.id,
      number: p.number,
      titleAr: p.titleAr,
      titleEn: p.titleEn,
      status: p.status,
      currency: p.currency,
      issueDate: p.issueDate,
      expiryDate: p.expiryDate,
      createdAt: p.createdAt.toISOString(),
      version: p.version,
      supersedesId: p.supersedesId,
      clientId: p.clientId,
      projectId: p.projectId,
      clientNameEn: p.clientNameEn,
      clientNameAr: p.clientNameAr,
      discountPct: p.discountPct,
      taxRate: p.taxRate,
      supervisionPct: p.supervisionPct,
      subtotal: p.subtotal,
      discountAmount: p.discountAmount,
      taxableBase: p.taxableBase,
      taxAmount: p.taxAmount,
      supervisionAmount: p.supervisionAmount,
      total: p.total,
      notesAr: p.notesAr,
      notesEn: p.notesEn,
      termsAr: p.termsAr,
      termsEn: p.termsEn,
      sections,
    };
    if (canSeeMargin) {
      detail.totalCost = p.totalCost;
      detail.totalMargin = p.totalMargin;
    }
    return detail;
  });
}

export function getProposalWithLines(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ProposalDetail | null> {
  return loadDetail(ctx, id, canSeeMargin);
}

export function getProposalForPdf(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ProposalDetail | null> {
  return loadDetail(ctx, id, canSeeMargin);
}
