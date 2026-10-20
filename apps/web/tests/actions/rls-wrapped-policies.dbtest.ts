import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appQuery,
  closeExecutionFixture,
  seedExecutionContract,
  type ExecutionContract,
} from './execution-fixture';
import { closeFixture, seedOrg, teardown } from './fixture';

// Stage 2 DB step A: every org policy reads its context ONCE per query. The
// static half (no bare helper call in policies/*.sql) is
// packages/db/src/rls/policy-wrapped.test.ts; this is the planner's half, on
// the live catalogue: the membership helper is an InitPlan, run once, and no
// per-row Filter calls it. The isolation gate and the cross-org cases in
// execution-schema.dbtest.ts prove the ANSWER is unchanged.

const orgIds: string[] = [];
let orgId: string;
let ownerId: string;
let contract: ExecutionContract;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgId = seeded.orgId;
  ownerId = seeded.ownerIds[0];
  orgIds.push(orgId);
  contract = await seedExecutionContract(orgId, { linesPerSection: [400], state: 'signed' });
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** The plan of `query` as metra_app in the owner's org context, one line per row. */
async function planOf(query: string, params: unknown[] = []): Promise<string> {
  const rows = await appQuery<Record<string, string>>(
    orgId,
    ownerId,
    `explain (analyze, costs off, timing off, summary off) ${query}`,
    params,
  );
  return rows.map((row) => Object.values(row)[0]).join('\n');
}

describe('org policies evaluate the membership helper once per query', () => {
  for (const table of [
    'contract_lines',
    'contract_line_measurements',
    'payment_requests',
    'clients',
    'memberships',
    'notifications',
  ]) {
    it(`${table}: the helper is an InitPlan, never a per-row call`, async () => {
      const plan = await planOf(`select count(*) from public.${table}`);
      expect(plan, plan).toMatch(/InitPlan/);
      for (const line of plan.split('\n').filter((text) => /Filter:/.test(text))) {
        expect(line, plan).not.toMatch(/app_is_current_org_member\(\)/);
      }
    });
  }

  it('answers the member exactly the rows the policy admits (400 lines, one InitPlan read)', async () => {
    const plan = await planOf(`select count(*) from public.contract_lines where contract_id = $1`, [
      contract.contractId,
    ]);
    expect(plan).toMatch(/InitPlan/);
    const [count] = await appQuery<{ n: number }>(
      orgId,
      ownerId,
      `select count(*)::int as n from public.contract_lines where contract_id = $1`,
      [contract.contractId],
    );
    expect(count.n).toBe(400);
  });
});
