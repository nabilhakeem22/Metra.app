import 'server-only';
// The proposal header projection, and the one query that reads it.
//
// The projection is DATA, not thirty lines inside a function: it is
// `ProposalDetail` minus the one COMPUTED field (`sections`), with `createdAt`
// still a Date. That correspondence is what lets the assembly in ./detail.ts
// spread it rather than re-listing thirty fields a second time, where one could
// silently go missing and nothing would fail.
import { clients, proposals, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';

const PROPOSAL_HEADER_COLUMNS = {
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
} as const;

/** The proposal row plus the client's names, or undefined when RLS hides it. */
export async function loadProposalHeader(tx: MetraDb, proposalId: string) {
  const [header] = await tx
    .select(PROPOSAL_HEADER_COLUMNS)
    .from(proposals)
    .leftJoin(clients, eq(clients.id, proposals.clientId))
    .where(eq(proposals.id, proposalId))
    .limit(1);
  return header;
}
