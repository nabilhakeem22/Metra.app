import 'server-only';
// Everything the final account card (الحساب الختامي) shows, in one org
// transaction: the account's figures (computed, never stored: the contract,
// approved change orders and the measured provisional works summed in SQL,
// minus every request issued before it), what stands in the way of issuing it
// (open change orders), the issued final account request if there is one, and
// the first page of measured differences with what each bills or that it is
// flagged. Bounded: one page of 50 lines, every other figure an aggregate.
import type { ContractStatus, MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { computeFinalAccount, finalAccountFigures, type FinalAccountFigures } from '../money/final-account';
import { requestOutstanding } from '../money/outstanding';
import { loadExecutionContract, type ExecutionContractBasis } from '../queries/execution-contract';
import { loadMeasuredWorks } from '../queries/measured-works';
import { loadContractMoneyFacts, type ContractMoneyFacts } from '../queries/money-facts';
import { countDifferences, listDifferences, type DifferenceRow } from './differences';

export interface FinalAccountDifference extends Omit<DifferenceRow, 'unitPrice' | 'discountPct'> {
  residualQty: string;
  /** What the difference bills before the document discount; null on a flagged firm line. */
  works: string | null;
}

export interface FinalAccountDifferencesPage {
  rows: FinalAccountDifference[];
  nextCursor: string | null;
}

export interface IssuedFinalAccount {
  id: string;
  documentNumber: string;
  amount: string;
  paid: string;
  outstanding: string;
}

export interface FinalAccountView {
  contractId: string;
  status: ContractStatus;
  originalValue: string;
  /** The account as issued, or as it would be issued now. */
  figures: FinalAccountFigures;
  /** Change orders awaiting a decision: the account cannot be issued while any is. */
  openVariationCount: number;
  issued: IssuedFinalAccount | null;
  counts: { billed: number; flagged: number };
  differences: FinalAccountDifferencesPage;
}

async function loadIssuedFinalAccount(tx: MetraDb, contractId: string): Promise<IssuedFinalAccount | null> {
  const rows = (await tx.execute(sql`
    select r.id, r.number, to_char(r.issued_on, 'YYYY-MM-DD') as issued_on, r.amount::text as amount,
           coalesce((select sum(p.amount) from public.contract_payments p where p.request_id = r.id), 0)::text as paid
      from public.payment_requests r
     where r.contract_id = ${contractId} and r.kind = 'final_account' and r.status = 'issued'
     limit 1
  `)) as unknown as Array<{ id: string; number: number; issued_on: string; amount: string; paid: string }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    documentNumber: formatDocNumber('PR', row.number, docYear(row.issued_on, row.issued_on)),
    amount: row.amount,
    paid: formatMoney4(parseMoney4(row.paid)),
    outstanding: requestOutstanding(row.amount, [row.paid]),
  };
}

/** The basis of the figures: once issued, "billed so far" is what was billed before it, so its balance is its amount. */
function figuresBasis(contract: ExecutionContractBasis, money: ContractMoneyFacts, issued: IssuedFinalAccount | null) {
  const billed4 = parseMoney4(money.issuedRequestsTotal) - parseMoney4(issued?.amount ?? '0');
  return { ...contract, approvedVariationNetDeltas: money.approvedVariationNetDeltas, issuedRequestsTotal: formatMoney4(billed4) };
}

/** One page of differences, each priced by computeFinalAccount's own rule. */
export async function loadDifferencesPage(
  tx: MetraDb,
  contract: ExecutionContractBasis,
  afterLineId: string | null,
): Promise<FinalAccountDifferencesPage> {
  const page = await listDifferences(tx, contract.id, afterLineId);
  const account = computeFinalAccount({
    ...contract,
    approvedVariationNetDeltas: [],
    issuedRequestsTotal: '0',
    measuredLines: page.rows,
  });
  const billed = new Map(account.billedLines.map((line) => [line.lineId, line]));
  const flagged = new Map(account.flaggedLines.map((line) => [line.lineId, line]));
  return {
    nextCursor: page.nextCursor,
    rows: page.rows.map(({ unitPrice: _price, discountPct: _discount, ...row }) => ({
      ...row,
      residualQty: (billed.get(row.lineId) ?? flagged.get(row.lineId))?.residualQty ?? '0.0000',
      works: billed.get(row.lineId)?.works ?? null,
    })),
  };
}

export function getFinalAccount(ctx: OrgContext, contractId: string): Promise<FinalAccountView | null> {
  return withOrgContext(ctx, async (tx) => {
    const contract = await loadExecutionContract(tx, contractId);
    if (!contract) return null;
    const money = await loadContractMoneyFacts(tx, contractId);
    const issued = await loadIssuedFinalAccount(tx, contractId);
    return {
      contractId,
      status: contract.status,
      originalValue: contract.originalValue,
      figures: finalAccountFigures(figuresBasis(contract, money, issued), await loadMeasuredWorks(tx, contractId)),
      openVariationCount: money.openVariationCount,
      issued,
      counts: await countDifferences(tx, contractId),
      differences: await loadDifferencesPage(tx, contract, null),
    };
  });
}

/** One more page of differences after `afterLineId`; null when the contract is not the caller's. */
export function getFinalAccountDifferences(
  ctx: OrgContext,
  contractId: string,
  afterLineId: string,
): Promise<FinalAccountDifferencesPage | null> {
  return withOrgContext(ctx, async (tx) => {
    const contract = await loadExecutionContract(tx, contractId);
    return contract ? loadDifferencesPage(tx, contract, afterLineId) : null;
  });
}
