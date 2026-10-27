import 'server-only';
// Everything the delivery's execution card needs to derive its stage, and the
// same stage, with its schedule, for one contract's page. One transaction
// each, and nothing in it grows with the number of lines: the schedule has at
// most 12 rows, and money, the measured works included, is aggregated in SQL
// to single figures.
//
// The delivery's facts are ONE statement, `app_execution_flow_source`
// (packages/db rls/functions/65-execution-facts.sql): the delivery's issued
// BOQ, the contract on it (plan A26; a light delivery's by its project), that
// contract's schedule, money facts and measured works. The client home reads
// the same statement through its token function, so the cockpit and the
// client derive their facts from one SQL (../flow-facts.ts).
import { sql } from 'drizzle-orm';
import { loadContractSigning } from '@/lib/contracts/queries/signing';
import { loadScheduleRows, scheduleView, type ContractScheduleView } from '@/lib/contracts/schedule/queries';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import type { ExecutionCockpitFacts } from '../card-view';
import { contractStageFacts, executionCardFactsOf, type StagedContract } from '../flow-facts';
import { executionFlowSourceOf } from '../flow-source';
import { executionStage, type ExecutionStage } from '../stage';
import { loadMeasuredWorks } from './measured-works';
import { loadContractMoneyFacts } from './money-facts';

/**
 * The execution card's facts for a delivery at `execution`, and, once its
 * contract is signed, how (the studio sees the name an online signer typed,
 * H6.2 functional F4): a second statement only then.
 */
export function getExecutionFacts(ctx: OrgContext, engagementId: string): Promise<ExecutionCockpitFacts> {
  return withOrgContext(ctx, async (tx) => {
    const rows = (await tx.execute(sql`select public.app_execution_flow_source(${engagementId}) as source`)) as unknown as Array<{
      source: unknown;
    }>;
    const card = executionCardFactsOf(executionFlowSourceOf(rows[0].source));
    const signed = card.contract?.status === 'signed' ? await loadContractSigning(tx, card.contract.id) : null;
    return { ...card, signed };
  });
}

/** What an execution contract's page reads beyond the contract: its schedule and its stage. */
export interface ContractPageExecution {
  /** The Schedule tab's rows, when that tab shows. */
  schedule: ContractScheduleView | null;
  /** Where a SIGNED contract stands (signed, final account issued, settled); null before it is signed. */
  stage: ExecutionStage | null;
}

/**
 * An execution contract page's reads, in ONE transaction that reads the
 * schedule rows once: the Schedule tab's view of them, and for a signed
 * contract its stage (stage.ts) by the same facts the delivery card reads, so
 * its page says where it stands rather than how it began. A page that needs
 * neither opens no transaction.
 */
export async function getContractPageExecution(
  ctx: OrgContext,
  contract: StagedContract,
  wants: { schedule: boolean },
): Promise<ContractPageExecution> {
  const signed = contract.status === 'signed';
  if (!wants.schedule && !signed) return { schedule: null, stage: null };
  return withOrgContext(ctx, async (tx) => {
    const schedule = scheduleView(await loadScheduleRows(tx, contract.id), contract);
    if (!signed) return { schedule: wants.schedule ? schedule : null, stage: null };
    const money = await loadContractMoneyFacts(tx, contract.id);
    const measuredWorks = money.finalAccount ? null : await loadMeasuredWorks(tx, contract.id);
    const { facts } = contractStageFacts(contract, schedule, { money, measuredWorks });
    return { schedule: wants.schedule ? schedule : null, stage: executionStage({ hasIssuedBoq: true, contract: facts }).stage };
  });
}
