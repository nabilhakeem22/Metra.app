import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueBoqCore } from '@/lib/boqs/issue';
import { generateExecutionContractCore } from '@/lib/contracts/core';
import type { OrgContext } from '@/lib/db/context';
import { seedBoq, type SeededBoq } from './contract-from-boq-fixture';
import { closeExecutionFixture, ownerQuery } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

// PR A3, the early refusal: Issue on a draft whose project's issued BOQ has a
// live contract answers `boq_has_contract` BEFORE Chromium runs or a file is
// stored (the renderer is the call that renders AND uploads). The freeze's own
// refusal stays the race backstop (boq-has-contract.dbtest.ts).

const render = vi.hoisted(() => ({ renderAndStoreClientBoqPdf: vi.fn() }));
vi.mock('@/lib/boqs/issue/render', () => ({
  renderAndStoreClientBoqPdf: render.renderAndStoreClientBoqPdf,
}));
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

beforeEach(() => {
  render.renderAndStoreClientBoqPdf.mockReset();
  render.renderAndStoreClientBoqPdf.mockImplementation(
    async (_ctx: unknown, input: { engagementId: string }) => {
      const [file] = await ownerQuery<{ id: string }>(
        `insert into public.files (org_id, entity, entity_id, object_key, original_name)
         values ($1, 'engagement', $2, $3 || '/engagement/' || gen_random_uuid(), 'BQ.pdf') returning id`,
        [orgId, input.engagementId, orgId],
      );
      return { fileId: file.id, label: 'BQ.pdf' };
    },
  );
});

const fileCount = async (engagementId: string) =>
  (await ownerQuery<{ n: number }>(
    `select count(*)::int as n from public.files where entity_id = $1`,
    [engagementId],
  ))[0].n;

const statusOf = async (boqId: string) =>
  (await ownerQuery<{ status: string }>(`select status from public.boqs where id = $1`, [boqId]))[0].status;

/** An issued BOQ with a generated contract, and a new draft on the same project. */
async function contractedProjectWithDraft(): Promise<{ issued: SeededBoq; draftId: string; contractId: string }> {
  const issued = await seedBoq(orgId);
  const contractId = (
    await generateExecutionContractCore(owner, { boqId: issued.boqId, taxRate: '14', supervisionPct: '0' })
  ).data!;
  const draft = await seedBoq(orgId, {
    state: 'draft',
    deliveryState: null,
    project: { clientId: issued.clientId, projectId: issued.projectId },
  });
  return { issued, draftId: draft.boqId, contractId };
}

describe('Issue refuses a contracted project before rendering', () => {
  it('answers boq_has_contract without calling the renderer or storing a file', async () => {
    const { issued, draftId } = await contractedProjectWithDraft();
    const filesBefore = await fileCount(issued.engagementId!);

    const result = await issueBoqCore(owner, { boqId: draftId, locale: 'en' });

    expect(result).toEqual({ ok: false, error: 'boq_has_contract' });
    expect(render.renderAndStoreClientBoqPdf).not.toHaveBeenCalled();
    expect(await fileCount(issued.engagementId!)).toBe(filesBefore);
    expect(await statusOf(issued.boqId)).toBe('issued');
    expect(await statusOf(draftId)).toBe('draft');
  });

  it('renders and issues once the contract is terminated', async () => {
    const { issued, draftId, contractId } = await contractedProjectWithDraft();
    await ownerQuery(`update public.contracts set status = 'terminated' where id = $1`, [contractId]);

    const result = await issueBoqCore(owner, { boqId: draftId, locale: 'en' });

    expect(result).toMatchObject({ ok: true });
    expect(render.renderAndStoreClientBoqPdf).toHaveBeenCalledTimes(1);
    expect(await statusOf(issued.boqId)).toBe('superseded');
    expect(await statusOf(draftId)).toBe('issued');
  });

  it('a project with no contract still renders (the early read does not over-refuse)', async () => {
    const issued = await seedBoq(orgId);
    const draft = await seedBoq(orgId, {
      state: 'draft',
      deliveryState: null,
      project: { clientId: issued.clientId, projectId: issued.projectId },
    });

    const result = await issueBoqCore(owner, { boqId: draft.boqId, locale: 'en' });

    expect(result).toMatchObject({ ok: true });
    expect(render.renderAndStoreClientBoqPdf).toHaveBeenCalledTimes(1);
  });
});
