import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordContractSignedOfflineCore } from '@/lib/contracts/core';
import { todayInCairo } from '@/lib/automation/clock';
import type { OrgContext } from '@/lib/db/context';
import type { MemberRole } from '@metra/db';
import { seedProposalContract } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery, seedExecutionContract } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A3.2, owner decision D5: the studio records that the client signed an
// issued execution contract on paper. Owner, admin or project manager only.

const orgIds: string[] = [];
let orgId: string;
const ctx: Partial<Record<MemberRole, OrgContext>> = {};
const ROLES: MemberRole[] = ['admin', 'project_manager', 'site_engineer', 'accountant', 'viewer'];

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1, members: ROLES.map((role) => ({ role })) });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  ctx.owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
  ROLES.forEach((role, index) => (ctx[role] = ctxFor(orgId, seeded.memberIds[index], role)));
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

const TODAY = todayInCairo(new Date());

async function trail(contractId: string) {
  const [row] = await ownerQuery<{ status: string; kind: string | null; actor: string | null; day: string | null }>(
    `select c.status, e.kind, e.actor_user_id::text as actor,
            to_char(e.decided_at at time zone 'Africa/Cairo', 'YYYY-MM-DD') as day
       from public.contracts c
       left join public.contract_events e on e.contract_id = c.id and e.kind = 'acknowledged_offline'
      where c.id = $1`,
    [contractId],
  );
  return row;
}

/** The contract's `issued` event, at `at` (a timestamptz literal): what issueContractCore writes. */
async function issuedAt(contractId: string, at: string): Promise<void> {
  await ownerQuery(
    `insert into public.contract_events (org_id, contract_id, kind, from_status, to_status, decided_at)
     values ($1, $2, 'issued', 'draft', 'issued', $3::timestamptz)`,
    [orgId, contractId, at],
  );
}

describe('recordContractSignedOfflineCore', () => {
  it('flips issued -> signed and records the day the client signed and who recorded it', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    await issuedAt(contract.contractId, '2026-09-28 11:00+03');
    const res = await recordContractSignedOfflineCore(ctx.owner!, {
      contractId: contract.contractId,
      signedOn: '2026-10-01',
      note: 'Signed at the site office',
    });
    expect(res).toEqual({ ok: true, data: undefined });
    expect(await trail(contract.contractId)).toEqual({
      status: 'signed',
      kind: 'acknowledged_offline',
      actor: ctx.owner!.userId,
      day: '2026-10-01',
    });
  });

  it('is open to owner, admin and project manager only', async () => {
    for (const role of ['admin', 'project_manager'] as const) {
      const contract = await seedExecutionContract(orgId, { state: 'issued' });
      expect(await recordContractSignedOfflineCore(ctx[role]!, { contractId: contract.contractId, signedOn: TODAY })).toMatchObject({ ok: true });
    }
    for (const role of ['site_engineer', 'accountant', 'viewer'] as const) {
      const contract = await seedExecutionContract(orgId, { state: 'issued' });
      expect(await recordContractSignedOfflineCore(ctx[role]!, { contractId: contract.contractId, signedOn: TODAY })).toEqual({
        ok: false,
        error: 'forbidden',
      });
      expect((await trail(contract.contractId)).status).toBe('issued');
    }
  });

  it('refuses a draft, a signed and a terminated contract (contract_not_signable) and a proposal contract', async () => {
    for (const state of ['draft', 'signed'] as const) {
      const contract = await seedExecutionContract(orgId, { state });
      expect(await recordContractSignedOfflineCore(ctx.owner!, { contractId: contract.contractId, signedOn: TODAY })).toEqual({
        ok: false,
        error: 'contract_not_signable',
      });
    }
    const terminated = await seedExecutionContract(orgId, { state: 'issued' });
    await ownerQuery(`update public.contracts set status = 'terminated' where id = $1`, [terminated.contractId]);
    expect(await recordContractSignedOfflineCore(ctx.owner!, { contractId: terminated.contractId, signedOn: TODAY })).toEqual({
      ok: false,
      error: 'contract_not_signable',
    });
    const proposalContractId = await seedProposalContract(orgId);
    expect(await recordContractSignedOfflineCore(ctx.owner!, { contractId: proposalContractId, signedOn: TODAY })).toEqual({
      ok: false,
      error: 'contract_not_execution',
    });
  });

  it('says a missing, impossible or future day and an over-long note under their boxes', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    const id = contract.contractId;
    expect(await recordContractSignedOfflineCore(ctx.owner!, { contractId: id, signedOn: '' })).toMatchObject({
      fields: { signedOn: { code: 'required' } },
    });
    expect(await recordContractSignedOfflineCore(ctx.owner!, { contractId: id, signedOn: '2026-02-30' })).toMatchObject({
      fields: { signedOn: { code: 'invalid_date' } },
    });
    expect(
      await recordContractSignedOfflineCore(ctx.owner!, { contractId: id, signedOn: '2999-01-01', note: 'x'.repeat(501) }),
    ).toMatchObject({
      error: 'check_fields',
      fields: { signedOn: { code: 'date_in_future' }, note: { code: 'too_long', params: { max: 500 } } },
    });
    expect((await trail(id)).status).toBe('issued');
  });

  it('refuses a day before the Cairo issue day under its box, and takes the issue day itself (A3 F6, S1)', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    // 00:30 in Cairo on Oct 5 is still Oct 4 in UTC: the Cairo day decides.
    await issuedAt(contract.contractId, '2026-10-05 00:30+03');
    const id = contract.contractId;
    for (const signedOn of ['2026-10-04', '2001-01-01', '0001-01-01']) {
      expect(await recordContractSignedOfflineCore(ctx.owner!, { contractId: id, signedOn }), signedOn).toEqual({
        ok: false,
        error: 'check_fields',
        fields: { signedOn: { code: 'date_before_issue', params: { date: '2026-10-05' } } },
      });
    }
    expect((await trail(id)).status).toBe('issued');
    expect(await recordContractSignedOfflineCore(ctx.owner!, { contractId: id, signedOn: '2026-10-05' })).toMatchObject({ ok: true });
    expect(await trail(id)).toMatchObject({ status: 'signed', day: '2026-10-05' });
  });

  it('says year 0 is not a day (never a 22008), and a null or non-object payload is malformed', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    expect(await recordContractSignedOfflineCore(ctx.owner!, { contractId: contract.contractId, signedOn: '0000-01-01' })).toEqual({
      ok: false,
      error: 'check_fields',
      fields: { signedOn: { code: 'invalid_date' } },
    });
    for (const payload of [null, undefined, 'x', 7, true]) {
      const call = recordContractSignedOfflineCore as (ctx: OrgContext, input: unknown) => ReturnType<typeof recordContractSignedOfflineCore>;
      expect(await call(ctx.owner!, payload), String(payload)).toEqual({ ok: false, error: 'malformed' });
    }
    expect((await trail(contract.contractId)).status).toBe('issued');
  });

  it('two concurrent recordings sign once and write one event', async () => {
    const contract = await seedExecutionContract(orgId, { state: 'issued' });
    const results = await Promise.all([
      recordContractSignedOfflineCore(ctx.owner!, { contractId: contract.contractId, signedOn: TODAY }),
      recordContractSignedOfflineCore(ctx.admin!, { contractId: contract.contractId, signedOn: TODAY }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toEqual({ ok: false, error: 'contract_not_signable' });
    const [events] = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from public.contract_events where contract_id = $1 and kind = 'acknowledged_offline'`,
      [contract.contractId],
    );
    expect(events.n).toBe(1);
  });
});
