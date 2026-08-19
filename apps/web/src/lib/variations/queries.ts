import 'server-only';
import {
  contracts,
  variationOrderLines,
  variationOrders,
  type VariationStatus,
} from '@metra/db';
import { and, asc, desc, eq } from 'drizzle-orm';
import { computeVariationNetDelta } from '@/lib/aggregates/contract-value';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface VariationListRow {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: VariationStatus;
  netDelta: string;
  contractId: string;
  contractNumber: number | null;
  createdAt: string;
}

export interface ListVariationsFilter {
  contractId?: string;
  projectId?: string;
  status?: VariationStatus;
}

export function listVariations(
  ctx: OrgContext,
  filter: ListVariationsFilter = {},
): Promise<VariationListRow[]> {
  return withOrgContext(ctx, async (tx) => {
    const conds = [];
    if (filter.contractId) conds.push(eq(variationOrders.contractId, filter.contractId));
    if (filter.projectId) conds.push(eq(variationOrders.projectId, filter.projectId));
    if (filter.status) conds.push(eq(variationOrders.status, filter.status));
    const rows = await tx
      .select({
        id: variationOrders.id,
        number: variationOrders.number,
        titleAr: variationOrders.titleAr,
        titleEn: variationOrders.titleEn,
        status: variationOrders.status,
        netDelta: variationOrders.netDelta,
        contractId: variationOrders.contractId,
        contractNumber: contracts.number,
        createdAt: variationOrders.createdAt,
      })
      .from(variationOrders)
      .leftJoin(contracts, eq(contracts.id, variationOrders.contractId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(variationOrders.number));
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}

/** Σ netDelta of the APPROVED VOs for a project (the register's bottom line). */
export async function getProjectApprovedVariationTotal(
  ctx: OrgContext,
  projectId: string,
): Promise<string> {
  return withOrgContext(ctx, async (tx) => {
    const rows = await tx
      .select({ netDelta: variationOrders.netDelta })
      .from(variationOrders)
      .where(
        and(
          eq(variationOrders.projectId, projectId),
          eq(variationOrders.status, 'approved'),
        ),
      );
    // Reuse the pure aggregate: treat each netDelta as a single-line "total".
    return computeVariationNetDelta(
      rows.map((r) => ({ lineCost: '0', lineTotal: r.netDelta, lineMargin: '0' })),
    );
  });
}

export interface VariationDetailLine {
  id: string;
  contractLineId: string | null;
  costItemId: string | null;
  descriptionAr: string | null;
  descriptionEn: string | null;
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

export interface VariationDetail {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  reasonAr: string | null;
  reasonEn: string | null;
  status: VariationStatus;
  netDelta: string;
  contractId: string;
  contractNumber: number | null;
  projectId: string;
  currency: string;
  createdAt: string;
  lines: VariationDetailLine[];
}

export function getVariationWithLines(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<VariationDetail | null> {
  return withOrgContext(ctx, async (tx) => {
    const [v] = await tx
      .select({
        id: variationOrders.id,
        number: variationOrders.number,
        titleAr: variationOrders.titleAr,
        titleEn: variationOrders.titleEn,
        reasonAr: variationOrders.reasonAr,
        reasonEn: variationOrders.reasonEn,
        status: variationOrders.status,
        netDelta: variationOrders.netDelta,
        contractId: variationOrders.contractId,
        contractNumber: contracts.number,
        currency: contracts.currency,
        projectId: variationOrders.projectId,
        createdAt: variationOrders.createdAt,
      })
      .from(variationOrders)
      .leftJoin(contracts, eq(contracts.id, variationOrders.contractId))
      .where(eq(variationOrders.id, id))
      .limit(1);
    if (!v) return null;

    const rawLines = await tx
      .select()
      .from(variationOrderLines)
      .where(eq(variationOrderLines.variationOrderId, id))
      .orderBy(asc(variationOrderLines.sortOrder));

    const lines: VariationDetailLine[] = rawLines.map((l) => {
      const base: VariationDetailLine = {
        id: l.id,
        contractLineId: l.contractLineId,
        costItemId: l.costItemId,
        descriptionAr: l.descriptionAr,
        descriptionEn: l.descriptionEn,
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

    return {
      id: v.id,
      number: v.number,
      titleAr: v.titleAr,
      titleEn: v.titleEn,
      reasonAr: v.reasonAr,
      reasonEn: v.reasonEn,
      status: v.status,
      netDelta: v.netDelta,
      contractId: v.contractId,
      contractNumber: v.contractNumber,
      projectId: v.projectId,
      currency: v.currency ?? 'EGP',
      createdAt: v.createdAt.toISOString(),
      lines,
    };
  });
}
