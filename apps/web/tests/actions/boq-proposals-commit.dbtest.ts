import { afterAll, describe, expect, it, vi } from 'vitest';
import { createBoqCore } from '@/lib/boqs/core';
import { getBoqDetail, getProjectBoq, getProjectBoqSummary } from '@/lib/boqs/queries';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { mintDeliveryLinkCore } from '@/lib/engagements/share';
import { createCostItemCore } from '@/lib/price-book/core';
import { listCostItems } from '@/lib/price-book/queries';
import { saveProposalDraftCore } from '@/lib/proposals/core';
import {
  boqProposalWith,
  commitFromSnapshot,
  engagementAtBoq,
  rawEngagement,
  seedBoqOrg,
  TWO_SECTIONS,
} from './boq-proposal-fixture';
import { deliveryOrNull } from './delivery-read';
import { closeFixture, raw, teardown } from './fixture';

// The ONE write of Send as BOQ, against a real Postgres: what the commit
// creates, that the database re-sums it to the mapper's figures, that it is
// published and versioned, that its fences hold, and what deleting the
// engagement does to it afterwards. The render is replaced by a stored `files`
// row (commitFromSnapshot), which is all the commit consumes.
vi.mock('@/lib/pdf/render', () => ({
  renderPdf: () => Promise.reject(new Error('no renderer in the dbtest runner')),
}));

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

interface BoqRow {
  id: string;
  number: number;
  status: string;
  source: string;
  source_proposal_id: string | null;
  engagement_id: string | null;
  version: number;
  supersedes_id: string | null;
  subtotal: string;
  discount_amount: string;
  total: string;
  total_cost: string;
  total_margin: string;
  created_year: number;
}

async function boqRows(orgId: string): Promise<BoqRow[]> {
  return raw.query<BoqRow>(
    `select id, number, status, source, source_proposal_id, engagement_id, version,
            supersedes_id, subtotal::text, discount_amount::text, total::text,
            total_cost::text, total_margin::text,
            extract(year from created_at at time zone 'UTC')::int as created_year
       from public.boqs where org_id = '${orgId}' order by created_at`,
  );
}

async function boqArtifacts(engagementId: string) {
  return raw.query<{ id: string; client_visible: boolean }>(
    `select id, client_visible from public.engagement_artifacts
      where engagement_id = '${engagementId}' and kind = 'boq' order by attested_at`,
  );
}

async function proposalStatus(id: string): Promise<string | undefined> {
  const [row] = await raw.query<{ status: string }>(
    `select status from public.proposals where id = '${id}'`,
  );
  return row?.status;
}

describe('commitProposalBoqCore writes the BOQ (AC8, AC9, AC25)', () => {
  it('one issued, built BOQ with the mapped rows, item codes and cost, for a margin-blind PM', async () => {
    const org = await seedBoqOrg(orgIds);
    await raw.query(
      `update public.organizations set hide_margin_from_pm = true where id = '${org.orgId}'`,
    );
    await createCostItemCore(org.ctx, {
      code: 'CI-7',
      nameEn: 'Gypsum board',
      sectionId: await raw.sectionId(org.orgId),
      unit: 'sqm',
      defaultUnitCost: '100',
      defaultUnitPrice: '150',
    });
    const [costItem] = await listCostItems(org.ctx, {});
    const engagementId = await rawEngagement(org);
    const proposalId = await boqProposalWith(org.ctx, engagementId, [
      {
        titleEn: 'Boards',
        lines: [
          { costItemId: costItem.id, descriptionEn: 'Board', qty: '10', unit: 'sqm', unitCost: '100', unitPrice: '150', discountPct: '0' },
        ],
      },
      ...TWO_SECTIONS,
    ]);

    const { result, mapped } = await commitFromSnapshot(org.pmCtx, org.orgId, proposalId);
    expect(result.ok).toBe(true);

    const rows = await boqRows(org.orgId);
    expect(rows).toHaveLength(1);
    const [boq] = rows;
    expect(boq).toMatchObject({
      id: result.data!.boqId,
      status: 'issued',
      source: 'built',
      source_proposal_id: proposalId,
      engagement_id: engagementId,
      version: 1,
    });
    const [counts] = await raw.query<{ sections: number; lines: number }>(
      `select (select count(*)::int from public.boq_sections where boq_id = '${boq.id}') as sections,
              (select count(*)::int from public.boq_lines where boq_id = '${boq.id}') as lines`,
    );
    expect(Number(counts.sections)).toBe(mapped.sectionCount);
    expect(Number(counts.lines)).toBe(mapped.lineCount);
    expect(mapped.sectionCount).toBe(3);

    const [boardLine] = await raw.query<{ item_code: string | null; unit_cost: string }>(
      `select item_code, unit_cost::text from public.boq_lines
        where boq_id = '${boq.id}' and cost_item_id = '${costItem.id}'`,
    );
    expect(boardLine.item_code).toBe('CI-7');
    expect(Number(boardLine.unit_cost)).toBe(100);

    // AC9: the database re-sum equals the mapper, as strings.
    expect({
      subtotal: boq.subtotal,
      discountAmount: boq.discount_amount,
      total: boq.total,
      totalCost: boq.total_cost,
      totalMargin: boq.total_margin,
    }).toEqual(mapped.totals);
    expect(await proposalStatus(proposalId)).toBe('draft');

    // AC25 / AC16: one document number, from the UTC year of created_at.
    const number = String(boq.number).padStart(4, '0');
    expect(result.data!.documentNumber).toBe(`BQ-${boq.created_year}-${number}`);
    expect((await getProjectBoqSummary(org.ctx, org.projectId))?.documentNumber).toBe(
      result.data!.documentNumber,
    );
  });
});

describe('every send publishes, and the portal still withholds until paid (AC10)', () => {
  it('satisfies finalizeBOQ, is withheld while the balance is owed, downloadable once paid', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await engagementAtBoq(org);
    const minted = await mintDeliveryLinkCore(org.ctx, engagementId);
    expect(minted.ok).toBe(true);
    const proposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);

    expect((await commitFromSnapshot(org.ctx, org.orgId, proposalId)).result.ok).toBe(true);
    const [artifact] = await boqArtifacts(engagementId);
    expect(artifact.client_visible).toBe(true);

    const listed = async () =>
      (await deliveryOrNull(minted.data!))?.documents.find((d) => d.id === artifact.id)?.access;
    expect(await listed()).toBe('withheld');

    expect(
      (await executeTransition(org.ctx, { engagementId, trigger: 'finalizeBOQ' })).ok,
    ).toBe(true);

    expect(
      (await recordPaymentCore(org.ctx, { engagementId, kind: 'balance', amount: '30000' })).ok,
    ).toBe(true);
    expect(await listed()).toBe('download');
  });
});

describe('a second send is the next version (AC11)', () => {
  it('supersedes v1, takes the next number, and only v2 is visible', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const proposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
    const first = await commitFromSnapshot(org.ctx, org.orgId, proposalId);
    expect(first.result.ok).toBe(true);
    await saveProposalDraftCore(org.ctx, { id: proposalId, sections: TWO_SECTIONS.slice(0, 1) });
    const second = await commitFromSnapshot(org.ctx, org.orgId, proposalId);
    expect(second.result.ok).toBe(true);

    const [v1, v2] = await boqRows(org.orgId);
    expect(v1.id).toBe(first.result.data!.boqId);
    expect(v2).toMatchObject({
      id: second.result.data!.boqId,
      status: 'issued',
      version: 2,
      supersedes_id: v1.id,
      number: v1.number + 1,
    });
    expect(v1.status).toBe('superseded');
    expect(second.result.data!.documentNumber).not.toBe(first.result.data!.documentNumber);

    const artifacts = await boqArtifacts(engagementId);
    expect(artifacts.map((a) => a.client_visible)).toEqual([false, true]);

    expect((await getProjectBoq(org.ctx, org.projectId, { showCost: false }))?.id).toBe(v2.id);
    expect((await getBoqDetail(org.ctx, v1.id, { showCost: false }))?.id).toBe(v1.id);
    expect(await proposalStatus(proposalId)).toBe('draft');
  });
});

describe('the fences turn a moved world into boq_send_conflict (AC12, AC25)', () => {
  async function expectNothingWritten(engagementId: string, proposalId: string) {
    const [row] = await raw.query<{ n: number }>(
      `select count(*)::int as n from public.boqs where source_proposal_id = '${proposalId}'`,
    );
    expect(Number(row.n)).toBe(0);
    expect(await boqArtifacts(engagementId)).toEqual([]);
    expect(await proposalStatus(proposalId)).toBe('draft');
  }

  it('the proposal was saved after the snapshot', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const proposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
    const { result } = await commitFromSnapshot(org.ctx, org.orgId, proposalId, async () => {
      await saveProposalDraftCore(org.ctx, { id: proposalId, sections: TWO_SECTIONS.slice(2) });
    });
    expect(result).toEqual({ ok: false, error: 'boq_send_conflict' });
    await expectNothingWritten(engagementId, proposalId);
  });

  it('another BOQ took the peeked number', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const proposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
    const { result } = await commitFromSnapshot(org.ctx, org.orgId, proposalId, async () => {
      await createBoqCore(org.ctx, { projectId: org.projectId, titleEn: 'Uploaded sheet' });
    });
    expect(result).toEqual({ ok: false, error: 'boq_send_conflict' });
    await expectNothingWritten(engagementId, proposalId);
  });

  it('the year turned between the snapshot and the commit', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const proposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
    const { result } = await commitFromSnapshot(org.ctx, org.orgId, proposalId, (input) => {
      input.expectedYear -= 1;
    });
    expect(result).toEqual({ ok: false, error: 'boq_send_conflict' });
    await expectNothingWritten(engagementId, proposalId);
  });
});

describe('deleting the engagement afterwards (AC14)', () => {
  it('removes the BOQ proposal and detaches the issued BOQ, which survives issued', async () => {
    const org = await seedBoqOrg(orgIds);
    const engagementId = await rawEngagement(org);
    const proposalId = await boqProposalWith(org.ctx, engagementId, TWO_SECTIONS);
    expect((await commitFromSnapshot(org.ctx, org.orgId, proposalId)).result.ok).toBe(true);

    await raw.query(`delete from public.design_engagements where id = '${engagementId}'`);

    expect(await proposalStatus(proposalId)).toBeUndefined();
    const [boq] = await boqRows(org.orgId);
    expect(boq.status).toBe('issued');
    expect(boq.source_proposal_id).toBeNull();
    expect(boq.engagement_id).toBeNull();
  });
});
