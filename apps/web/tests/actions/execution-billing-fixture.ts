// PR A4 DB-test fixture: a SIGNED execution contract with the 50 / 30 / 20
// schedule the client signed, and readers of what the billing cores wrote. Not
// a test file. The contract is execution-fixture.ts's (value 124,000.0000, VAT
// 14,000.0000), so the rows bill 62,000 / 37,200 / 24,800 with VAT 7,000 /
// 4,200 / 2,800. Teardown is fixture.ts's.
import { ownerQuery, seedExecutionContract, type ContractState, type ExecutionContract } from './execution-fixture';

export interface BilledContract extends ExecutionContract {
  /** The schedule rows, by sort order. */
  milestoneIds: string[];
}

export async function seedBillableContract(orgId: string, state: ContractState = 'signed'): Promise<BilledContract> {
  const contract = await seedExecutionContract(orgId, {
    state,
    schedule: [
      { labelEn: 'Advance', basis: 'percent', value: '50' },
      { labelEn: 'Works', basis: 'percent', value: '30' },
      { labelEn: 'Handover', basis: 'percent', value: '20' },
    ],
  });
  const rows = await ownerQuery<{ id: string }>(
    `select id from public.contract_payment_milestones where contract_id = $1 order by sort_order`,
    [contract.contractId],
  );
  return { ...contract, milestoneIds: rows.map((row) => row.id) };
}

export interface StoredRequest {
  id: string;
  number: number;
  kind: string;
  status: string;
  amount: string;
  tax_amount: string;
  issued_on: string;
  due_on: string | null;
  note: string | null;
  issued_by: string;
  voided_by: string | null;
  voided: boolean;
}

export async function requestRow(id: string): Promise<StoredRequest> {
  const [row] = await ownerQuery<StoredRequest>(
    `select id, number, kind::text, status::text, amount::text, tax_amount::text,
            to_char(issued_on, 'YYYY-MM-DD') as issued_on, to_char(due_on, 'YYYY-MM-DD') as due_on,
            note, issued_by::text, voided_by::text, voided_at is not null as voided
       from public.payment_requests where id = $1`,
    [id],
  );
  return row;
}

export async function requestCount(contractId: string): Promise<number> {
  const [row] = await ownerQuery<{ n: number }>(
    `select count(*)::int as n from public.payment_requests where contract_id = $1`,
    [contractId],
  );
  return row.n;
}

/** A client's pending "I paid" on a request (what the /d SDF writes in DB step B). */
export async function seedPendingClaim(orgId: string, contractId: string, requestId: string): Promise<string> {
  const [row] = await ownerQuery<{ id: string }>(
    `insert into public.contract_payment_claims (org_id, contract_id, request_id, claimed_amount)
     values ($1, $2, $3, 1) returning id`,
    [orgId, contractId, requestId],
  );
  return row.id;
}

/** A payment straight into the ledger (the connection role), for the void tests. */
export async function seedPayment(
  orgId: string,
  contractId: string,
  requestId: string,
  recordedBy: string,
  amount = '1',
): Promise<void> {
  await ownerQuery(
    `insert into public.contract_payments (org_id, contract_id, request_id, amount, received_on, recorded_by)
     values ($1, $2, $3, $4, current_date, $5)`,
    [orgId, contractId, requestId, amount, recordedBy],
  );
}
