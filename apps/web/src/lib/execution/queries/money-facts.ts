import 'server-only';
// What has been billed, paid and claimed on one execution contract, aggregated
// in SQL (plan A25): one statement whatever the number of requests, payments
// or change orders, and only figures cross the wire. The statement is
// `app_contract_money_facts` (packages/db rls/functions/65-execution-facts.sql),
// the SAME one the client home's facts are built from; this reads it inside
// the caller's org transaction, where RLS scopes every table to the org.
import type { MetraDb } from '@metra/db';
import { sql } from 'drizzle-orm';
import { contractMoneyFactsOf, type ContractMoneyFacts } from '../flow-source';

export async function loadContractMoneyFacts(tx: MetraDb, contractId: string): Promise<ContractMoneyFacts> {
  const rows = (await tx.execute(sql`select public.app_contract_money_facts(${contractId}) as facts`)) as unknown as Array<{
    facts: unknown;
  }>;
  return contractMoneyFactsOf(rows[0].facts);
}
