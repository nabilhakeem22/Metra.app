// Client home (DB step C) DB-test fixture: homes (a design delivery at
// `execution`, or a LIGHT one born there), the client's address on file, and
// direct calls of the home's token functions with exactly the arguments the
// app will pass: never a raw code, only sha256(purpose:target:code). Not a
// test file. Rows are written over the BYPASSRLS connection; teardown is
// fixture.ts's.
import { createHash, randomInt } from 'node:crypto';
import { createSql } from '@metra/db';
import { mintShareToken } from '@/lib/share/token';
import { seedBillableContract, type BilledContract } from './execution-billing-fixture';
import { ownerQuery, seedExecutionContract, tamper, type ContractState } from './execution-fixture';
import { seedDelivery, type SeededDelivery } from './delivery-execution-fixture';

export type CodePurpose = 'sign_contract' | 'decide_variation' | 'claim_request' | 'claim_design_payment';

/** What the app stores and sends for a code: the hash binds the code to the act it is for. */
export function codeHashOf(purpose: CodePurpose, target: string, code: string): string {
  return createHash('sha256').update(`${purpose}:${target}:${code}`).digest('hex');
}

/** A six-digit code as the app makes one. */
export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export interface Home {
  delivery: SeededDelivery;
  contract: BilledContract;
}

/** A design delivery at `execution` whose BOQ became an execution contract, the client's email on file. */
export async function seedHome(orgId: string, contractState: ContractState = 'issued', email: string | null = 'Client.Name@Example.com'): Promise<Home> {
  const delivery = await seedDelivery(orgId);
  const contract = await seedBillableContract(orgId, contractState, delivery);
  if (email !== null) await setClientEmail(orgId, delivery.clientId, email);
  return { delivery, contract };
}

/**
 * A LIGHT delivery (entry_phase 'execution', 0065): an execution contract on a
 * BOQ no delivery stands behind, and the home born at `execution` on its
 * project, as ensureClientHomeCore will create it.
 */
export async function seedLightHome(orgId: string, contractState: ContractState = 'issued'): Promise<Home> {
  const contract = await seedExecutionContract(orgId, {
    state: contractState,
    schedule: [
      { labelEn: 'Advance', basis: 'percent', value: '50' },
      { labelEn: 'Works', basis: 'percent', value: '30' },
      { labelEn: 'Handover', basis: 'percent', value: '20' },
    ],
  });
  const milestones = await ownerQuery<{ id: string }>(
    `select id from public.contract_payment_milestones where contract_id = $1 order by sort_order`,
    [contract.contractId],
  );
  const token = mintShareToken();
  const [row] = await ownerQuery<{ id: string }>(
    `insert into public.design_engagements (org_id, number, client_id, project_id, state, entry_phase, title_en, token_hash)
     values ($1, (select coalesce(max(number), 0) + 1 from public.design_engagements where org_id = $1),
             $2, $3, 'execution', 'execution', 'Light home', $4)
     returning id`,
    [orgId, contract.clientId, contract.projectId, token.hash],
  );
  await setClientEmail(orgId, contract.clientId, 'light@example.org');
  return {
    delivery: { id: row.id, clientId: contract.clientId, projectId: contract.projectId, rawToken: token.raw, tokenHash: token.hash },
    contract: { ...contract, milestoneIds: milestones.map((milestone) => milestone.id) },
  };
}

/** The client's own address (`clients.email`). */
export async function setClientEmail(orgId: string, clientId: string, email: string | null): Promise<void> {
  await ownerQuery(`update public.clients set email = $3 where org_id = $1 and id = $2`, [orgId, clientId, email]);
}

/** A primary contact of the client, with its own address. */
export async function seedPrimaryContact(orgId: string, clientId: string, email: string | null): Promise<void> {
  await ownerQuery(
    `insert into public.client_contacts (org_id, client_id, name, email, is_primary) values ($1, $2, 'Primary', $3, true)`,
    [orgId, clientId, email],
  );
}

export interface IssueAnswer {
  status: string;
  challenge_id?: string;
  limit?: string;
  email?: string;
  hint?: string;
  resend_after_seconds?: number;
  retry_after_seconds?: number;
  platform_day_half_crossed?: boolean;
  studio?: { name_ar: string | null; name_en: string | null };
  document?: { prefix: string; number: number; year: number };
}

export interface RequestedCode {
  /** The code's row, as the database answered it (for the server only; '' when no code was made). */
  challengeId: string;
  code: string;
  answer: IssueAnswer;
}

/** The app's code request: a fresh code, only its hash passed. */
export async function requestCode(
  tokenHash: string | null,
  purpose: CodePurpose,
  target: string | null,
  extra: { ip?: string | null; ua?: string | null; code?: string } = {},
): Promise<RequestedCode> {
  const code = extra.code ?? newCode();
  const [row] = await ownerQuery<{ answer: IssueAnswer }>(
    `select public.app_home_code_issue_by_token($1, $2, $3, $4, $5, $6) as answer`,
    [tokenHash, purpose, target, codeHashOf(purpose, target ?? '', code), extra.ip ?? null, extra.ua ?? null],
  );
  return { challengeId: row.answer.challenge_id ?? '', code, answer: row.answer };
}

/** The app's mark after a send that failed: the code spends no day limit. */
export async function markUnsent(tokenHash: string, challengeId: string): Promise<string> {
  const [row] = await ownerQuery<{ answer: string }>(`select public.app_home_code_unsent_by_token($1, $2::uuid) as answer`, [
    tokenHash,
    challengeId,
  ]);
  return row.answer;
}

export interface ActAnswer {
  code: string;
  attempts_left?: number;
  limit?: string;
  retry_after_seconds?: number;
}

/** Sign the home's contract with a code. */
export async function signWithCode(
  tokenHash: string,
  contractId: string,
  code: string,
  extra: { name?: string; pdfHash?: string } = {},
): Promise<ActAnswer> {
  const [row] = await ownerQuery<{ answer: ActAnswer }>(
    `select public.app_home_contract_ack_by_token($1, $2::uuid, $3, $4, '127.0.0.1', 'vitest', $5) as answer`,
    [tokenHash, contractId, codeHashOf('sign_contract', contractId, code), extra.name ?? 'Client Name', extra.pdfHash ?? 'f'.repeat(64)],
  );
  return row.answer;
}

/** Approve or reject one change order of the home's contract with a code. */
export async function decideWithCode(tokenHash: string, variationId: string, decision: string, code: string): Promise<ActAnswer> {
  const [row] = await ownerQuery<{ answer: ActAnswer }>(
    `select public.app_home_variation_respond_by_token($1, $2::uuid, $3, $4, 'Client Name', '127.0.0.1', 'vitest') as answer`,
    [tokenHash, variationId, decision, codeHashOf('decide_variation', variationId, code)],
  );
  return row.answer;
}

/** "I paid" on one payment request of the home's contract with a code. */
export async function claimRequestWithCode(tokenHash: string, requestId: string, code: string): Promise<ActAnswer> {
  const [row] = await ownerQuery<{ answer: ActAnswer }>(
    `select public.app_home_claim_request_by_token($1, $2::uuid, $3, null, 'Client Name', '127.0.0.1', 'vitest') as answer`,
    [tokenHash, requestId, codeHashOf('claim_request', requestId, code)],
  );
  return row.answer;
}

/** "I paid" on one design-fee instalment with a code. */
export async function claimDesignWithCode(tokenHash: string, milestoneKind: string, code: string): Promise<ActAnswer> {
  const [row] = await ownerQuery<{ answer: ActAnswer }>(
    `select public.app_home_claim_design_payment_by_token($1, $2, $3, null, 'Client Name', '127.0.0.1', 'vitest') as answer`,
    [tokenHash, milestoneKind, codeHashOf('claim_design_payment', milestoneKind, code)],
  );
  return row.answer;
}

export interface StoredCode {
  id: string;
  engagement_id: string;
  purpose: string;
  target_key: string;
  destination_hash: string;
  destination_hint: string;
  code_hash: string;
  attempts: number;
  consumed_at: string | null;
  result_ref: string | null;
  actor_ip: string | null;
  actor_user_agent: string | null;
}

export async function codesOf(engagementId: string): Promise<StoredCode[]> {
  return ownerQuery<StoredCode>(
    `select id, engagement_id, purpose, target_key, destination_hash, destination_hint, code_hash, attempts,
            consumed_at, result_ref, actor_ip, actor_user_agent
       from public.client_verification_codes where engagement_id = $1 order by created_at, id`,
    [engagementId],
  );
}

/** Move a delivery's codes back in time, as if made `seconds` earlier (every user trigger off). */
export async function ageCodes(engagementId: string, seconds: number): Promise<void> {
  await tamper(
    `update public.client_verification_codes
        set created_at = created_at - make_interval(secs => $2::int),
            expires_at = expires_at - make_interval(secs => $2::int)
      where engagement_id = $1`,
    [engagementId, seconds],
  );
}

class Released extends Error {}

/**
 * A studio transaction on its own connection that runs `lockSql` (a row lock,
 * or an advisory lock) and holds what it took until `release`, or `maxMs` at
 * most: what a studio write holding a row looks like to the client's calls.
 */
export async function holdLock(lockSql: string, params: unknown[], maxMs = 9000): Promise<{ release(): Promise<void> }> {
  const holder = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
  let letGo: () => void = () => undefined;
  const decided = new Promise<void>((resolve) => {
    letGo = resolve;
    setTimeout(resolve, maxMs);
  });
  let locked: () => void = () => undefined;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const finished = holder
    .begin(async (tx) => {
      await tx.unsafe(lockSql, params as never[]);
      locked();
      await decided;
      throw new Released();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Released)) throw error;
    })
    .finally(() => holder.end());
  await isLocked;
  return {
    async release() {
      letGo();
      await finished;
    },
  };
}

/** The home's JSON, as the page will read it. */
export async function homeBySql<T = Record<string, unknown>>(tokenHash: string | null): Promise<T | null> {
  const [row] = await ownerQuery<{ home: T | null }>(`select public.app_home_by_token($1) as home`, [tokenHash]);
  return row.home;
}
