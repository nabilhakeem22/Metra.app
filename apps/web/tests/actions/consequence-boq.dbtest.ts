// Round C, C3, AC 9 and AC 10: sending or issuing the BOQ completes the delivery's
// BOQ step when the sender may fire `finalizeBOQ` (owner decision Q1), with the
// sender on the ledger row. A project manager's send records the BOQ and leaves
// the step. Only the Chromium half is replaced, by a stand-in that stores a real
// `files` row (as boq-issue-e2e.dbtest.ts does).
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sendProposalAsBoqCore } from '@/lib/boq-proposals/core/send';
import { commitImportCore, createBoqCore } from '@/lib/boqs/core';
import { issueBoqCore } from '@/lib/boqs/issue';
import { saveProposalDraftCore } from '@/lib/proposals/core';
import { boqProposalWith, engagementAtBoq, seedBoqOrg, TWO_SECTIONS, type BoqOrg } from './boq-proposal-fixture';
import { closeFixture, raw, teardown } from './fixture';

vi.mock('@/lib/boqs/issue/render', () => ({
  renderAndStoreClientBoqPdf: async (ctx: { orgId: string }, input: { engagementId: string }) => {
    const { raw: db } = await import('./fixture');
    const [file] = await db.query<{ id: string }>(
      `insert into public.files (org_id, entity, entity_id, object_key, original_name)
       values ('${ctx.orgId}', 'engagement', '${input.engagementId}',
               '${ctx.orgId}/engagement/' || gen_random_uuid(), 'BQ.pdf') returning id`,
    );
    return { fileId: file.id, label: 'BQ.pdf' };
  },
}));
vi.mock('@/lib/pdf/render', () => ({
  renderPdf: () => Promise.reject(new Error('no renderer in the dbtest runner')),
}));

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

async function boqStepRows(engagementId: string) {
  return raw.query<{ actor_user_id: string | null }>(
    `select actor_user_id from public.engagement_transitions
      where engagement_id = '${engagementId}' and trigger = 'finalizeBOQ'`,
  );
}

async function issuedBoqs(engagementId: string): Promise<number> {
  const [row] = await raw.query<{ n: number }>(
    `select count(*)::int as n from public.boqs where engagement_id = '${engagementId}' and status = 'issued'`,
  );
  return row.n;
}

describe('Send as BOQ completes the BOQ step (AC 9)', () => {
  it('an owner: issued, step done with the owner on the ledger; a replay moves nothing; a later version is not at the step', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await engagementAtBoq(org);
    const proposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);

    const sent = await sendProposalAsBoqCore(org.ctx, { proposalId, locale: 'en' });
    expect(sent).toMatchObject({ ok: true, data: { boqStep: 'completed' } });
    expect(await stateOf(engagementId)).toBe('execution_decision');
    expect(await boqStepRows(engagementId)).toEqual([{ actor_user_id: org.ctx.userId }]);

    const replay = await sendProposalAsBoqCore(org.ctx, { proposalId, locale: 'en' });
    expect(replay).toEqual({ ok: true, data: { documentNumber: sent.data!.documentNumber, boqStep: 'not_at_boq' } });
    expect(await boqStepRows(engagementId)).toHaveLength(1);

    const changed = TWO_SECTIONS.map((section) => ({ ...section, titleEn: `${section.titleEn} v2` }));
    expect((await saveProposalDraftCore(org.ctx, { id: proposalId, sections: changed })).ok).toBe(true);
    const second = await sendProposalAsBoqCore(org.ctx, { proposalId, locale: 'en' });
    expect(second).toMatchObject({ ok: true, data: { boqStep: 'not_at_boq' } });
    expect(second.data!.documentNumber).not.toBe(sent.data!.documentNumber);
    expect(await stateOf(engagementId)).toBe('execution_decision');
    expect(await boqStepRows(engagementId)).toHaveLength(1);
  });

  it('a project manager: the BOQ is issued, the step waits for owner, admin or accountant', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await engagementAtBoq(org);
    const proposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);

    const sent = await sendProposalAsBoqCore(org.pmCtx, { proposalId, locale: 'en' });
    expect(sent).toMatchObject({ ok: true, data: { boqStep: 'not_permitted' } });
    expect(await issuedBoqs(engagementId)).toBe(1);
    expect(await stateOf(engagementId)).toBe('boq');
    expect(await boqStepRows(engagementId)).toEqual([]);
  });
});

/** An imported one-line draft BOQ on the org's project (the sheet's path). */
async function sheetDraft(org: BoqOrg): Promise<string> {
  const created = await createBoqCore(org.ctx, { projectId: org.projectId, titleEn: 'Sheet' });
  const boqId = (created as { data?: string }).data!;
  await commitImportCore(org.ctx, {
    boqId,
    lines: [
      {
        itemCode: '2.01',
        section: 'Gypsum works',
        description: '12mm gypsum ceiling',
        unit: 'sqm',
        qty: '100',
        unitPrice: '1500',
        unitCost: '0',
        costItemCode: null,
        provisional: false,
      },
    ],
  });
  return boqId;
}

describe("the sheet's Issue completes the BOQ step (AC 10)", () => {
  it('an owner: step done, the owner on the ledger row', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await engagementAtBoq(org);
    const issued = await issueBoqCore(org.ctx, { boqId: await sheetDraft(org), locale: 'en' });
    expect(issued).toMatchObject({ ok: true, data: { boqStep: 'completed' } });
    expect(await stateOf(engagementId)).toBe('execution_decision');
    expect(await boqStepRows(engagementId)).toEqual([{ actor_user_id: org.ctx.userId }]);
  });

  it('a project manager: issued, the step waits', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await engagementAtBoq(org);
    const issued = await issueBoqCore(org.pmCtx, { boqId: await sheetDraft(org), locale: 'en' });
    expect(issued).toMatchObject({ ok: true, data: { boqStep: 'not_permitted' } });
    expect(await issuedBoqs(engagementId)).toBe(1);
    expect(await stateOf(engagementId)).toBe('boq');
  });
});
