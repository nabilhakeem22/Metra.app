import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mutateInOrg } from '@/lib/actions/mutate';
import { freezeAndRecordIssue } from '@/lib/boqs/issue';
import { generateExecutionContractCore } from '@/lib/contracts/core';
import type { OrgContext } from '@/lib/db/context';
import { seedBoq, type SeededBoq } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A3.3, AC9: an issued BOQ a live contract stands on is never superseded by
// a newer issue (`boq_has_contract`); changes after the contract are change
// orders. A terminated contract no longer holds it.

vi.mock('@/lib/pdf/render', () => ({
  renderPdf: () => Promise.reject(new Error('no renderer in the dbtest runner')),
}));

const orgIds: string[] = [];
let orgId: string;
let owner: OrgContext;

beforeAll(async () => {
  const seeded = await seedOrg({ owners: 1 });
  orgIds.push(seeded.orgId);
  orgId = seeded.orgId;
  owner = ctxFor(orgId, seeded.ownerIds[0], 'owner');
});

afterAll(async () => {
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

let fileSeq = 0;

/** Issue a new draft BOQ on the same project through the shared write half. */
async function issueNewVersion(issued: SeededBoq) {
  const next = await seedBoq(orgId, {
    state: 'draft',
    deliveryState: null,
    project: { clientId: issued.clientId, projectId: issued.projectId },
  });
  fileSeq += 1;
  const [file] = await ownerQuery<{ id: string }>(
    `insert into public.files (org_id, entity, entity_id, object_key, original_name)
     values ($1, 'engagement', $2, $3, 'BQ.pdf') returning id`,
    [orgId, issued.engagementId, `${orgId}/engagement/a3-${String(fileSeq)}.pdf`],
  );
  const result = await mutateInOrg(owner, { capability: 'boq_build', action: 'update' }, (tx) =>
    freezeAndRecordIssue(tx, owner, {
      boqId: next.boqId,
      projectId: issued.projectId,
      engagementId: issued.engagementId!,
      clientId: issued.clientId,
      fileId: file.id,
      label: 'BQ.pdf',
    }),
  );
  return { result, nextBoqId: next.boqId };
}

const statusOf = async (boqId: string) =>
  (await ownerQuery<{ status: string }>(`select status from public.boqs where id = $1`, [boqId]))[0].status;

describe('AC9: the issued BOQ under a contract stays issued', () => {
  it('refuses a newer issue with boq_has_contract, writing nothing', async () => {
    const issued = await seedBoq(orgId);
    expect(await generateExecutionContractCore(owner, { boqId: issued.boqId, taxRate: '14', supervisionPct: '0' })).toMatchObject({ ok: true });
    const { result, nextBoqId } = await issueNewVersion(issued);
    expect(result).toEqual({ ok: false, error: 'boq_has_contract' });
    expect(await statusOf(issued.boqId)).toBe('issued');
    expect(await statusOf(nextBoqId)).toBe('draft');
  });

  it('lets the issue through once the contract is terminated', async () => {
    const issued = await seedBoq(orgId);
    const contractId = (await generateExecutionContractCore(owner, { boqId: issued.boqId, taxRate: '14', supervisionPct: '0' })).data!;
    await ownerQuery(`update public.contracts set status = 'terminated' where id = $1`, [contractId]);
    const { result, nextBoqId } = await issueNewVersion(issued);
    expect(result).toMatchObject({ ok: true });
    expect(await statusOf(issued.boqId)).toBe('superseded');
    expect(await statusOf(nextBoqId)).toBe('issued');
  });

  it('a generate racing a newer issue: never a contract on a superseded BOQ', async () => {
    for (let run = 0; run < 5; run += 1) {
      const issued = await seedBoq(orgId);
      const [generated, reissued] = await Promise.all([
        generateExecutionContractCore(owner, { boqId: issued.boqId, taxRate: '14', supervisionPct: '0' }),
        issueNewVersion(issued),
      ]);
      // Exactly one of the two wins, and the loser names why.
      expect([generated.ok, reissued.result.ok].filter(Boolean)).toHaveLength(1);
      if (generated.ok) expect(reissued.result).toEqual({ ok: false, error: 'boq_has_contract' });
      else expect(generated).toEqual({ ok: false, error: 'boq_not_issued' });
      const [row] = await ownerQuery<{ n: number }>(
        `select count(*)::int as n from public.contracts c join public.boqs b on b.id = c.source_boq_id
          where b.status = 'superseded' and b.id = $1`,
        [issued.boqId],
      );
      expect(row.n).toBe(0);
    }
  });
});
