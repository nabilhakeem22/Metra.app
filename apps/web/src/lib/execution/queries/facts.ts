import 'server-only';
// Everything the delivery's execution card needs to derive its stage: the
// delivery's issued BOQ, the contract on it (plan A26), and that contract's
// money facts. One transaction, and nothing in it grows with the number of
// lines: the schedule has at most 12 rows, money is aggregated in SQL, and only
// measured provisional lines are read.
import { boqs, contracts, type ContractStatus, type MetraDb } from '@metra/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import { loadScheduleRows, scheduleView, type ScheduleRowView } from '@/lib/contracts/schedule/queries';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import { billingBalance, computeFinalAccount } from '../money/final-account';
import type { ExecutionContractFacts, ExecutionFacts } from '../stage';
import { loadBilledMeasuredLines } from './measured-lines';
import { loadContractMoneyFacts, type ContractMoneyFacts } from './money-facts';

export interface ExecutionCardContract {
  id: string;
  number: number;
  createdAt: string;
  status: ContractStatus;
}

export interface ExecutionCardFacts {
  facts: ExecutionFacts;
  /** The delivery's issued BOQ: what "create contract" generates from. */
  boqId: string | null;
  contract: ExecutionCardContract | null;
}

/** The newest contract on a BOQ of this delivery, a live one before a terminated one. */
async function loadDeliveryContract(tx: MetraDb, engagementId: string) {
  const [row] = await tx
    .select({
      id: contracts.id, number: contracts.number, createdAt: contracts.createdAt, status: contracts.status,
      sourceBoqId: contracts.sourceBoqId,
      originalValue: contracts.originalValue, taxAmount: contracts.taxAmount, taxRate: contracts.taxRate,
      supervisionPct: contracts.supervisionPct, discountPct: contracts.discountPct,
    })
    .from(contracts)
    .innerJoin(boqs, and(eq(boqs.id, contracts.sourceBoqId), eq(boqs.orgId, contracts.orgId)))
    .where(eq(boqs.engagementId, engagementId))
    .orderBy(asc(sql`(${contracts.status} = 'terminated')`), desc(contracts.createdAt), desc(contracts.id))
    .limit(1);
  return row ?? null;
}

async function loadIssuedBoqId(tx: MetraDb, engagementId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: boqs.id })
    .from(boqs)
    .where(and(eq(boqs.engagementId, engagementId), eq(boqs.status, 'issued')))
    .limit(1);
  return row?.id ?? null;
}

type DeliveryContract = NonNullable<Awaited<ReturnType<typeof loadDeliveryContract>>>;

/** The first schedule row no issued request bills yet, with what it would bill. */
function firstUnbilled(rows: ScheduleRowView[], money: ContractMoneyFacts): { id: string; amount: string } | null {
  const billed = new Set(money.billedMilestoneIds);
  const row = rows.find((candidate) => !billed.has(candidate.id) && candidate.amount !== null);
  return row?.amount ? { id: row.id, amount: row.amount } : null;
}

/** Once the final account request is issued, both balances are its figures (plan A3.5 addendum). */
function issuedFinalBalance(money: ContractMoneyFacts): string | null {
  if (!money.finalAccount) return null;
  return formatMoney4(parseMoney4(money.finalAccount.finalValue) - parseMoney4(money.issuedRequestsTotal));
}

/** A signed contract's billing facts; a draft or an unsigned one bills nothing yet. */
async function contractFacts(tx: MetraDb, contract: DeliveryContract): Promise<ExecutionContractFacts> {
  const schedule = scheduleView(await loadScheduleRows(tx, contract.id), contract);
  const idle: ExecutionContractFacts = {
    status: contract.status,
    scheduleValid: schedule.valid,
    nextUnbilledMilestone: null,
    pendingClaimCount: 0,
    unbilledVariationCount: 0,
    finalAccountOutstanding: null,
    unpaidRequestCount: 0,
    openVariationCount: 0,
    billingBalance: '0',
    finalAccountBalance: '0',
  };
  if (contract.status !== 'signed') return idle;

  const money = await loadContractMoneyFacts(tx, contract.id);
  const billing = {
    ...contract,
    approvedVariationNetDeltas: money.approvedVariationNetDeltas,
    issuedRequestsTotal: money.issuedRequestsTotal,
  };
  const issued = issuedFinalBalance(money);
  // Before a final account request: steering on billingBalance, the end state
  // on the full balance with the measured provisional lines (A3.5 addendum).
  const full = issued ?? computeFinalAccount({ ...billing, measuredLines: await loadBilledMeasuredLines(tx, contract.id) }).balance;
  return {
    ...idle,
    nextUnbilledMilestone: firstUnbilled(schedule.rows, money),
    pendingClaimCount: money.pendingClaimCount,
    unbilledVariationCount: money.unbilledVariationCount,
    finalAccountOutstanding: money.finalAccount?.outstanding ?? null,
    unpaidRequestCount: money.unpaidRequestCount,
    openVariationCount: money.openVariationCount,
    billingBalance: issued ?? billingBalance(billing),
    finalAccountBalance: full,
  };
}

/** The execution card's facts for a delivery at `execution`. */
export function getExecutionFacts(ctx: OrgContext, engagementId: string): Promise<ExecutionCardFacts> {
  return withOrgContext(ctx, async (tx) => {
    const boqId = await loadIssuedBoqId(tx, engagementId);
    const newest = await loadDeliveryContract(tx, engagementId);
    // A terminated contract on an older BOQ does not stand in front of the newer
    // issued one: the card offers to contract that one instead.
    const replaced = newest?.status === 'terminated' && boqId !== null && newest.sourceBoqId !== boqId;
    const contract = replaced ? null : newest;
    return {
      boqId,
      contract: contract
        ? { id: contract.id, number: contract.number, createdAt: contract.createdAt.toISOString(), status: contract.status }
        : null,
      facts: { hasIssuedBoq: boqId !== null, contract: contract ? await contractFacts(tx, contract) : null },
    };
  });
}
