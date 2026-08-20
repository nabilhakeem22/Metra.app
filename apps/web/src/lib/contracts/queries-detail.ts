import 'server-only';
import {
  clients,
  contractLines,
  contractSections,
  contracts,
  variationOrders,
  type ContractStatus,
} from '@metra/db';
import { and, asc, eq } from 'drizzle-orm';
import { computeRevisedContractValue } from '@/lib/aggregates/contract-value';
import { withOrgContext, type OrgContext } from '@/lib/db/context';

export interface ContractDetailLine {
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

export interface ContractDetailSection {
  id: string;
  titleAr: string | null;
  titleEn: string | null;
  sortOrder: number;
  sectionSubtotal: string;
  lines: ContractDetailLine[];
}

export interface ContractDetail {
  id: string;
  number: number;
  titleAr: string | null;
  titleEn: string | null;
  status: ContractStatus;
  currency: string;
  sourceProposalId: string;
  signatureDate: string | null;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  clientId: string;
  projectId: string;
  clientNameEn: string | null;
  clientNameAr: string | null;
  retentionPct: string;
  retentionReleaseTermsAr: string | null;
  retentionReleaseTermsEn: string | null;
  advancePct: string;
  advanceRecoveryMethod: string;
  paymentTermsDays: number | null;
  paymentScheduleMode: string;
  penaltyAr: string | null;
  penaltyEn: string | null;
  defectsLiabilityDays: number | null;
  scopeInclusionsAr: string | null;
  scopeInclusionsEn: string | null;
  scopeExclusionsAr: string | null;
  scopeExclusionsEn: string | null;
  termsAr: string | null;
  termsEn: string | null;
  discountPct: string;
  taxRate: string;
  supervisionPct: string;
  subtotal: string;
  discountAmount: string;
  taxableBase: string;
  taxAmount: string;
  supervisionAmount: string;
  originalValue: string;
  // Computed aggregate (A3): originalValue + Σ approved-VO netDeltas.
  revisedValue: string;
  sections: ContractDetailSection[];
  // margin-gated
  totalCost?: string;
  totalMargin?: string;
}

async function loadDetail(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ContractDetail | null> {
  return withOrgContext(ctx, async (tx) => {
    const [c] = await tx
      .select({
        id: contracts.id,
        number: contracts.number,
        titleAr: contracts.titleAr,
        titleEn: contracts.titleEn,
        status: contracts.status,
        currency: contracts.currency,
        sourceProposalId: contracts.sourceProposalId,
        signatureDate: contracts.signatureDate,
        startDate: contracts.startDate,
        endDate: contracts.endDate,
        createdAt: contracts.createdAt,
        clientId: contracts.clientId,
        projectId: contracts.projectId,
        retentionPct: contracts.retentionPct,
        retentionReleaseTermsAr: contracts.retentionReleaseTermsAr,
        retentionReleaseTermsEn: contracts.retentionReleaseTermsEn,
        advancePct: contracts.advancePct,
        advanceRecoveryMethod: contracts.advanceRecoveryMethod,
        paymentTermsDays: contracts.paymentTermsDays,
        paymentScheduleMode: contracts.paymentScheduleMode,
        penaltyAr: contracts.penaltyAr,
        penaltyEn: contracts.penaltyEn,
        defectsLiabilityDays: contracts.defectsLiabilityDays,
        scopeInclusionsAr: contracts.scopeInclusionsAr,
        scopeInclusionsEn: contracts.scopeInclusionsEn,
        scopeExclusionsAr: contracts.scopeExclusionsAr,
        scopeExclusionsEn: contracts.scopeExclusionsEn,
        termsAr: contracts.termsAr,
        termsEn: contracts.termsEn,
        discountPct: contracts.discountPct,
        taxRate: contracts.taxRate,
        supervisionPct: contracts.supervisionPct,
        subtotal: contracts.subtotal,
        discountAmount: contracts.discountAmount,
        taxableBase: contracts.taxableBase,
        taxAmount: contracts.taxAmount,
        supervisionAmount: contracts.supervisionAmount,
        originalValue: contracts.originalValue,
        totalCost: contracts.totalCost,
        totalMargin: contracts.totalMargin,
        clientNameEn: clients.nameEn,
        clientNameAr: clients.nameAr,
      })
      .from(contracts)
      .leftJoin(clients, eq(clients.id, contracts.clientId))
      .where(eq(contracts.id, id))
      .limit(1);
    if (!c) return null;

    const secs = await tx
      .select()
      .from(contractSections)
      .where(eq(contractSections.contractId, id))
      .orderBy(asc(contractSections.sortOrder));
    const allLines = await tx
      .select()
      .from(contractLines)
      .where(eq(contractLines.contractId, id))
      .orderBy(asc(contractLines.sortOrder));

    const linesBySection = new Map<string, typeof allLines>();
    for (const l of allLines) {
      const arr = linesBySection.get(l.sectionId);
      if (arr) arr.push(l);
      else linesBySection.set(l.sectionId, [l]);
    }

    const sections: ContractDetailSection[] = secs.map((s) => {
      const secLines = linesBySection.get(s.id) ?? [];
      const lines: ContractDetailLine[] = secLines.map((l) => {
        const base: ContractDetailLine = {
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
      return {
        id: s.id,
        titleAr: s.titleAr,
        titleEn: s.titleEn,
        sortOrder: s.sortOrder,
        sectionSubtotal: s.sectionSubtotal,
        lines,
      };
    });

    // Revised value = original + Σ netDelta of APPROVED VOs (A3, computed).
    const approved = await tx
      .select({ netDelta: variationOrders.netDelta })
      .from(variationOrders)
      .where(
        and(
          eq(variationOrders.contractId, id),
          eq(variationOrders.status, 'approved'),
        ),
      );
    const revisedValue = computeRevisedContractValue(
      c.originalValue,
      approved.map((v) => v.netDelta),
    );

    const detail: ContractDetail = {
      id: c.id,
      number: c.number,
      titleAr: c.titleAr,
      titleEn: c.titleEn,
      status: c.status,
      currency: c.currency,
      sourceProposalId: c.sourceProposalId,
      signatureDate: c.signatureDate,
      startDate: c.startDate,
      endDate: c.endDate,
      createdAt: c.createdAt.toISOString(),
      clientId: c.clientId,
      projectId: c.projectId,
      clientNameEn: c.clientNameEn,
      clientNameAr: c.clientNameAr,
      retentionPct: c.retentionPct,
      retentionReleaseTermsAr: c.retentionReleaseTermsAr,
      retentionReleaseTermsEn: c.retentionReleaseTermsEn,
      advancePct: c.advancePct,
      advanceRecoveryMethod: c.advanceRecoveryMethod,
      paymentTermsDays: c.paymentTermsDays,
      paymentScheduleMode: c.paymentScheduleMode,
      penaltyAr: c.penaltyAr,
      penaltyEn: c.penaltyEn,
      defectsLiabilityDays: c.defectsLiabilityDays,
      scopeInclusionsAr: c.scopeInclusionsAr,
      scopeInclusionsEn: c.scopeInclusionsEn,
      scopeExclusionsAr: c.scopeExclusionsAr,
      scopeExclusionsEn: c.scopeExclusionsEn,
      termsAr: c.termsAr,
      termsEn: c.termsEn,
      discountPct: c.discountPct,
      taxRate: c.taxRate,
      supervisionPct: c.supervisionPct,
      subtotal: c.subtotal,
      discountAmount: c.discountAmount,
      taxableBase: c.taxableBase,
      taxAmount: c.taxAmount,
      supervisionAmount: c.supervisionAmount,
      originalValue: c.originalValue,
      revisedValue,
      sections,
    };
    if (canSeeMargin) {
      detail.totalCost = c.totalCost;
      detail.totalMargin = c.totalMargin;
    }
    return detail;
  });
}

export function getContractWithLines(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ContractDetail | null> {
  return loadDetail(ctx, id, canSeeMargin);
}

export function getContractForPdf(
  ctx: OrgContext,
  id: string,
  canSeeMargin: boolean,
): Promise<ContractDetail | null> {
  return loadDetail(ctx, id, canSeeMargin);
}
