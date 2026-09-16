import 'server-only';
// The contract header projection, and the one query that reads it.
//
// The projection is DATA, not forty lines inside a function: it is
// `ContractDetail` minus the two COMPUTED fields (`revisedValue`, `sections`),
// with `createdAt` still a Date. That correspondence is what lets the assembly in
// ./detail.ts spread it rather than re-listing forty fields a second time, where
// one could silently go missing and nothing would fail.
import { clients, contracts, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';

const CONTRACT_HEADER_COLUMNS = {
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
} as const;

/** The contract row plus the client's names, or undefined when RLS hides it. */
export async function loadContractHeader(tx: MetraDb, contractId: string) {
  const [header] = await tx
    .select(CONTRACT_HEADER_COLUMNS)
    .from(contracts)
    .leftJoin(clients, eq(clients.id, contracts.clientId))
    .where(eq(contracts.id, contractId))
    .limit(1);
  return header;
}
