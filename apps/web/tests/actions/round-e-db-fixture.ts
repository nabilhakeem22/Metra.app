// Shared setup for the Round E database suites (migration 0060 and its apply-rls
// changes). Not a test file: imported by the delivery-db-step-0060 dbtests.
import { createSql } from '@metra/db';
import { sqlstateOf } from '@metra/db/sqlstate';
import { raw } from './fixture';
import {
  attestAt,
  forceState,
  seedArtifact,
  seedFeeSchedule,
  seedRoundBDelivery,
  stampRenders,
  type RoundBDelivery,
} from './round-b-fixture';

/** The four delivery token writes that wait on the delivery row, and wait at most 4 s (0060). */
export const TIMED_WRITES = {
  respond: 'public.app_delivery_respond_by_token(text, text, timestamptz, text, text, text, text)',
  claimPayment: 'public.app_delivery_claim_payment_by_token(text, text, text, text, text, text)',
  chooseConcept: 'public.app_delivery_choose_concept_by_token(text, uuid, integer, text, text, text, text)',
  comment: 'public.app_delivery_comment_by_token(text, uuid, text, text, text, text)',
} as const;

export type TimedWrite = keyof typeof TIMED_WRITES;

/** A delivery ready for one write: the SQL that makes it, and the client rows it adds. */
export interface PreparedWrite {
  delivery: RoundBDelivery;
  callSql: string;
  /** How many rows the write's ledger holds for this delivery. */
  rows: () => Promise<number>;
}

async function countOf(table: string, engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.${table} where engagement_id = '${engagementId}'`,
  );
  return row.n;
}

const CALLER = `'Client Sam', '1.2.3.4', 'probe/1'`;

/** Seed a delivery in the state `write` accepts, and the SQL of that one write. */
export async function prepareWrite(orgIds: string[], write: TimedWrite, suffix: string): Promise<PreparedWrite> {
  const delivery = await seedRoundBDelivery(orgIds, `${write}-${suffix}`);
  const { engagementId, hash } = delivery;
  if (write === 'respond') {
    await forceState(engagementId, 'final_approval');
    await stampRenders(engagementId, `now() - interval '1 hour'`);
    const [{ at }] = await raw.query<{ at: string }>(
      `select renders_ready_at::text as at from public.design_engagements where id = '${engagementId}'`,
    );
    return {
      delivery,
      callSql: `select public.app_delivery_respond_by_token('${hash}', 'approve_design', '${at}'::timestamptz, null, ${CALLER}) as code`,
      rows: () => countOf('engagement_events', engagementId),
    };
  }
  if (write === 'claimPayment') {
    await seedFeeSchedule(delivery);
    return {
      delivery,
      callSql: `select public.app_delivery_claim_payment_by_token('${hash}', 'deposit', null, ${CALLER}) as code`,
      rows: () => countOf('client_payment_claims', engagementId),
    };
  }
  if (write === 'chooseConcept') {
    await forceState(engagementId, 'concept_review');
    const option = await seedArtifact(delivery, 'concept_option');
    await attestAt(option, '2026-01-01T00:00:00Z');
    return {
      delivery,
      callSql: `select public.app_delivery_choose_concept_by_token('${hash}', '${option}'::uuid, 1, null, ${CALLER}) as code`,
      rows: () => countOf('engagement_events', engagementId),
    };
  }
  const render = await seedArtifact(delivery, 'approved_render');
  return {
    delivery,
    callSql: `select public.app_delivery_comment_by_token('${hash}', '${render}'::uuid, 'Is the wall moving?', ${CALLER}) as code`,
    rows: () => countOf('engagement_document_comments', engagementId),
  };
}

class Released extends Error {}

/**
 * A studio transaction holding the delivery row (`select ... for update`) on its
 * own connection until `release` runs: it then rolls back, or commits with
 * `{ commit: true }`. It lets go after `maxMs` whatever happens, so a write that
 * does NOT time out fails its assertion instead of hanging the suite.
 */
export async function holdDeliveryRow(engagementId: string, maxMs = 9000) {
  const holder = createSql(process.env.DATABASE_URL as string, { max: 1, prepare: false });
  let letGo: (commit: boolean) => void = () => undefined;
  const decided = new Promise<boolean>((resolve) => {
    letGo = resolve;
    setTimeout(() => resolve(false), maxMs);
  });
  let locked: () => void = () => undefined;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const finished = holder
    .begin(async (tx) => {
      await tx.unsafe(`select 1 from public.design_engagements where id = '${engagementId}' for update`);
      locked();
      if (!(await decided)) throw new Released();
    })
    .catch((error: unknown) => {
      if (!(error instanceof Released)) throw error;
    })
    .finally(() => holder.end());
  await isLocked;
  return {
    async release({ commit = false }: { commit?: boolean } = {}) {
      letGo(commit);
      await finished;
    },
  };
}

/** Run `query` and answer its code, or the SQLSTATE it failed with, and how long it took. */
export async function timedOutcome(run: () => Promise<Array<{ code: string }>>): Promise<{ outcome: string; ms: number }> {
  const started = performance.now();
  const outcome = await run().then(([row]) => row.code, (error: unknown) => sqlstateOf(error) ?? String(error));
  return { outcome, ms: performance.now() - started };
}
