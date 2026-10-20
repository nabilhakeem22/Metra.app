// PR B4 DB-test fixture: a delivery at `execution` whose BOQ became a signed
// execution contract (plan A26), with its share link, and the readers of what
// the client's "I paid" wrote. Not a test file. Rows are written over the
// BYPASSRLS connection; teardown is fixture.ts's.
import { mintShareToken } from '@/lib/share/token';
import { seedBillableContract, type BilledContract } from './execution-billing-fixture';
import { ownerQuery, seedClientProject, type ContractState, type DeliveryRef } from './execution-fixture';

export interface SeededDelivery extends DeliveryRef {
  rawToken: string;
  tokenHash: string;
}

/** A delivery with a live share link (or an expired one), at `state`. */
export async function seedDelivery(
  orgId: string,
  opts: { state?: string; expired?: boolean } = {},
): Promise<SeededDelivery> {
  const { clientId, projectId } = await seedClientProject(orgId);
  const token = mintShareToken();
  const [row] = await ownerQuery<{ id: string }>(
    `insert into public.design_engagements (org_id, number, client_id, project_id, state, title_en, token_hash, share_expires_at)
     values ($1, (select coalesce(max(number), 0) + 1 from public.design_engagements where org_id = $1),
             $2, $3, $4, 'Villa', $5, case when $6 then now() - interval '1 day' end)
     returning id`,
    [orgId, clientId, projectId, opts.state ?? 'execution', token.hash, opts.expired ?? false],
  );
  return { id: row.id, clientId, projectId, rawToken: token.raw, tokenHash: token.hash };
}

export interface ExecutionDelivery {
  delivery: SeededDelivery;
  /** The 50 / 30 / 20 contract of execution-billing-fixture.ts, on the delivery's BOQ. */
  contract: BilledContract;
}

export async function seedExecutionDelivery(orgId: string, contractState: ContractState = 'signed'): Promise<ExecutionDelivery> {
  const delivery = await seedDelivery(orgId);
  return { delivery, contract: await seedBillableContract(orgId, contractState, delivery) };
}

/** The app's direct call of the claim SDF, every argument the caller's. */
export async function claimBySql(
  tokenHash: string | null,
  requestId: string | null,
  extra: { note?: string | null; name?: string | null; ip?: string | null; ua?: string | null } = {},
): Promise<string> {
  const [row] = await ownerQuery<{ code: string }>(
    `select public.app_delivery_claim_request_by_token($1, $2::uuid, $3, $4, $5, $6) as code`,
    [tokenHash, requestId, extra.note ?? null, extra.name ?? null, extra.ip ?? null, extra.ua ?? null],
  );
  return row.code;
}

export interface StoredClaim {
  id: string;
  request_id: string;
  claimed_amount: string;
  status: string;
  note: string | null;
  actor_name: string | null;
  actor_ip: string | null;
  actor_user_agent: string | null;
}

export async function claimsOf(contractId: string): Promise<StoredClaim[]> {
  return ownerQuery<StoredClaim>(
    `select id, request_id, claimed_amount::text, status::text, note, actor_name, actor_ip, actor_user_agent
       from public.contract_payment_claims where contract_id = $1 order by created_at, id`,
    [contractId],
  );
}

/** The studio answers a claim "not received" by direct SQL (frees the pending slot). */
export async function dismissBySql(claimId: string, resolvedBy: string): Promise<void> {
  await ownerQuery(
    `update public.contract_payment_claims set status = 'dismissed', resolved_at = now(), resolved_by = $2 where id = $1`,
    [claimId, resolvedBy],
  );
}

export async function claimNotifications(contractId: string): Promise<Array<{ recipient_user_id: string; params: { number: number; year: number } }>> {
  return ownerQuery(
    `select recipient_user_id, params from public.notifications
      where entity_id = $1 and body_key = 'client_request_claimed' order by recipient_user_id`,
    [contractId],
  );
}
