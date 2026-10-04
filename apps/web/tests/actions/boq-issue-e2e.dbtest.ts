import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitImportCore, createBoqCore } from '@/lib/boqs/core';
import {
  addBoqLineCore,
  addBoqSectionCore,
  deleteBoqLineCore,
  setBoqDiscountCore,
  updateBoqLineCore,
} from '@/lib/boqs/edit';
import { issueBoqCore } from '@/lib/boqs/issue';
import type { BoqDetail } from '@/lib/boqs/queries';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import {
  engagementAtBoq,
  rawEngagement,
  seedBoqOrg,
  type BoqOrg,
} from './boq-proposal-fixture';
import { deliveryOrNull } from './delivery-read';
import { closeFixture, raw, teardown } from './fixture';

// THE SHEET'S ISSUE, END TO END: issueBoqCore with only the Chromium half
// replaced. The stand-in stores a real `files` row, which is all the write half
// consumes, and can run a side effect WHILE "rendering", which is how a
// concurrent edit is put between the read and the freeze.
const render = vi.hoisted(() => ({
  renderAndStoreClientBoqPdf: vi.fn(),
  duringRender: null as null | (() => Promise<void>),
}));
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
  render.duringRender = null;
  render.renderAndStoreClientBoqPdf.mockReset();
  render.renderAndStoreClientBoqPdf.mockImplementation(
    async (ctx: { orgId: string }, input: { detail: BoqDetail; engagementId: string }) => {
      if (render.duringRender) await render.duringRender();
      const [file] = await raw.query<{ id: string }>(
        `insert into public.files (org_id, entity, entity_id, object_key, original_name)
         values ('${ctx.orgId}', 'engagement', '${input.engagementId}',
                 '${ctx.orgId}/engagement/' || gen_random_uuid(), 'BQ.pdf')
         returning id`,
      );
      return { fileId: file.id, label: `BQ-${input.detail.number}.pdf` };
    },
  );
});

/** An uploaded (imported) one-line draft BOQ on the org's project. */
async function uploadedDraft(org: BoqOrg, title: string): Promise<string> {
  const created = await createBoqCore(org.ctx, { projectId: org.projectId, titleEn: title });
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

async function boqState(boqId: string) {
  const [row] = await raw.query<{
    status: string;
    source: string;
    source_proposal_id: string | null;
    version: number;
  }>(`select status, source, source_proposal_id, version from public.boqs where id = '${boqId}'`);
  return row;
}

async function boqArtifacts(engagementId: string) {
  return raw.query<{ id: string; client_visible: boolean }>(
    `select id, client_visible from public.engagement_artifacts
      where engagement_id = '${engagementId}' and kind = 'boq' order by attested_at`,
  );
}

describe('issueBoqCore end to end (AC17)', () => {
  it('reads the BOQ BY ID, publishes it, and the portal withholds it while unpaid', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await engagementAtBoq(org);
    const minted = await mintDeliveryLinkCore(org.ctx, engagementId);
    // Two drafts: the OLDER one is the project's "current" BOQ. Issuing the
    // newer one by id must render and freeze THAT one.
    const older = await uploadedDraft(org, 'First sheet');
    const target = await uploadedDraft(org, 'Second sheet');

    const issued = await issueBoqCore(org.ctx, { boqId: target, locale: 'en' });
    expect(issued.ok).toBe(true);
    const rendered = render.renderAndStoreClientBoqPdf.mock.calls[0][1] as { detail: BoqDetail };
    expect(rendered.detail.id).toBe(target);

    expect(await boqState(target)).toMatchObject({
      status: 'issued',
      source: 'imported',
      source_proposal_id: null,
      version: 1,
    });
    expect((await boqState(older)).status).toBe('superseded');

    const [artifact] = await boqArtifacts(engagementId);
    expect(artifact.client_visible).toBe(true);
    const listed = (await deliveryOrNull(minted.data!))?.documents.find(
      (d) => d.id === artifact.id,
    );
    expect(listed?.access).toBe('withheld');
  });
});

describe('the sheet Issue fences the BOQ content (R4)', () => {
  it('a line edited during the render refuses the freeze and writes nothing', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const boqId = await uploadedDraft(org, 'Sheet');
    const [line] = await raw.query<{ id: string }>(
      `select id from public.boq_lines where boq_id = '${boqId}'`,
    );
    render.duringRender = async () => {
      const edited = await updateBoqLineCore(org.ctx, { lineId: line.id, patch: { qty: '7' } });
      expect(edited.ok).toBe(true);
    };

    const refused = await issueBoqCore(org.ctx, { boqId, locale: 'en' });
    expect(refused).toEqual({ ok: false, error: 'boq_send_conflict' });
    expect((await boqState(boqId)).status).toBe('draft');
    expect(await boqArtifacts(engagementId)).toEqual([]);

    // Nothing moved this time: the retry issues what is now on the sheet.
    render.duringRender = null;
    expect((await issueBoqCore(org.ctx, { boqId, locale: 'en' })).ok).toBe(true);
    expect((await boqState(boqId)).status).toBe('issued');
  });

  it('every content write moves the revision the fence compares', async () => {
    const org = await seedBoqOrg(orgIds);
    const boqId = await uploadedDraft(org, 'Sheet');
    const revision = async () => {
      const [row] = await raw.query<{ r: string }>(
        `select (extract(epoch from updated_at) * 1000000)::bigint::text as r
           from public.boqs where id = '${boqId}'`,
      );
      return row.r;
    };
    const [section] = await raw.query<{ id: string }>(
      `select id from public.boq_sections where boq_id = '${boqId}'`,
    );
    const writes: Array<[string, () => Promise<{ ok: boolean }>]> = [
      ['add a section', () => addBoqSectionCore(org.ctx, { boqId, title: 'Paint' })],
      ['add a line', () => addBoqLineCore(org.ctx, { sectionId: section.id, description: 'Cornice' })],
      ['set the discount', () => setBoqDiscountCore(org.ctx, { boqId, discountPct: '5' })],
    ];
    for (const [label, write] of writes) {
      const before = await revision();
      expect((await write()).ok, label).toBe(true);
      expect(await revision(), label).not.toBe(before);
    }
    const [line] = await raw.query<{ id: string }>(
      `select id from public.boq_lines where boq_id = '${boqId}' order by sort_order limit 1`,
    );
    let before = await revision();
    expect((await updateBoqLineCore(org.ctx, { lineId: line.id, patch: { qty: '3' } })).ok).toBe(true);
    expect(await revision()).not.toBe(before);
    before = await revision();
    expect((await deleteBoqLineCore(org.ctx, { lineId: line.id })).ok).toBe(true);
    expect(await revision()).not.toBe(before);
  });
});
