import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendProposalAsBoqCore } from '@/lib/boq-proposals/core/send';
import { generateExecutionContractCore } from '@/lib/contracts/core';
import { boqProposalWith, engagementAtBoq, seedBoqOrg, TWO_SECTIONS, type BoqOrg } from './boq-proposal-fixture';
import { closeFixture, raw, teardown } from './fixture';

// PR A3, the early refusal on the Send as BOQ path: a send on a project whose
// issued BOQ has a live contract answers `boq_has_contract` BEFORE Chromium runs
// or a file is stored (the renderer is the call that renders AND uploads). The
// commit's own refusal stays the race backstop.

const render = vi.hoisted(() => ({ renderAndStoreClientBoqPdf: vi.fn() }));
vi.mock('@/lib/boqs/issue/render', () => ({
  renderAndStoreClientBoqPdf: render.renderAndStoreClientBoqPdf,
}));
vi.mock('@/lib/pdf/render', () => ({
  renderPdf: () => Promise.reject(new Error('no renderer in the dbtest runner')),
}));

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

beforeEach(() => {
  render.renderAndStoreClientBoqPdf.mockReset();
  render.renderAndStoreClientBoqPdf.mockImplementation(
    async (ctx: { orgId: string }, input: { engagementId: string }) => {
      const [file] = await raw.query<{ id: string }>(
        `insert into public.files (org_id, entity, entity_id, object_key, original_name)
         values ('${ctx.orgId}', 'engagement', '${input.engagementId}',
                 '${ctx.orgId}/engagement/' || gen_random_uuid(), 'BQ.pdf') returning id`,
      );
      return { fileId: file.id, label: 'BQ.pdf' };
    },
  );
});

const fileCount = async (engagementId: string) =>
  (await raw.query<{ n: number }>(
    `select count(*)::int as n from public.files where entity_id = '${engagementId}'`,
  ))[0].n;

const boqCount = async (engagementId: string) =>
  (await raw.query<{ n: number }>(
    `select count(*)::int as n from public.boqs where engagement_id = '${engagementId}'`,
  ))[0].n;

/**
 * A project whose issued BOQ has a live contract (its delivery is in execution,
 * which frees the project's one-active-engagement slot), and a NEW delivery on
 * the same project with a BOQ proposal ready to send.
 */
async function contractedProjectWithNewDelivery(org: BoqOrg) {
  const firstEngagementId = await engagementAtBoq(org);
  const firstProposalId = await boqProposalWith(org.ctx, firstEngagementId, TWO_SECTIONS);
  expect(await sendProposalAsBoqCore(org.ctx, { proposalId: firstProposalId, locale: 'en' })).toMatchObject({ ok: true });
  const [issued] = await raw.query<{ id: string }>(
    `select id from public.boqs where engagement_id = '${firstEngagementId}' and status = 'issued'`,
  );
  await raw.query(`update public.design_engagements set state = 'execution' where id = '${firstEngagementId}'`);
  const generated = await generateExecutionContractCore(org.ctx, {
    boqId: issued.id,
    taxRate: '14',
    supervisionPct: '0',
  });
  expect(generated).toMatchObject({ ok: true });

  const engagementId = await engagementAtBoq(org);
  const proposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
  render.renderAndStoreClientBoqPdf.mockClear();
  return { engagementId, proposalId, contractId: generated.data! };
}

describe('Send as BOQ refuses a contracted project before rendering', () => {
  it('answers boq_has_contract without calling the renderer, storing a file or writing a BOQ', async () => {
    const org = await seedBoqOrg(orgIds);
    const { engagementId, proposalId } = await contractedProjectWithNewDelivery(org);
    const filesBefore = await fileCount(engagementId);
    const boqsBefore = await boqCount(engagementId);

    const result = await sendProposalAsBoqCore(org.ctx, { proposalId, locale: 'en' });

    expect(result).toEqual({ ok: false, error: 'boq_has_contract' });
    expect(render.renderAndStoreClientBoqPdf).not.toHaveBeenCalled();
    expect(await fileCount(engagementId)).toBe(filesBefore);
    expect(await boqCount(engagementId)).toBe(boqsBefore);
  });

  it('renders and sends once the contract is terminated', async () => {
    const org = await seedBoqOrg(orgIds);
    const { proposalId, contractId } = await contractedProjectWithNewDelivery(org);
    await raw.query(`update public.contracts set status = 'terminated' where id = '${contractId}'`);

    const result = await sendProposalAsBoqCore(org.ctx, { proposalId, locale: 'en' });

    expect(result).toMatchObject({ ok: true });
    expect(render.renderAndStoreClientBoqPdf).toHaveBeenCalledTimes(1);
  });
});
