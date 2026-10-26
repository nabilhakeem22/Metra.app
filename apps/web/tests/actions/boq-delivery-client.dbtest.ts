import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitImportCore, createBoqCore } from '@/lib/boqs/core';
import { issueBoqCore } from '@/lib/boqs/issue';
import type { DocumentNames } from '@/lib/boqs/issue';
import type { BoqDetail } from '@/lib/boqs/queries';
import { createClientCore } from '@/lib/clients/core';
import { generateExecutionContractCore } from '@/lib/contracts/core';
import { getExecutionFacts } from '@/lib/execution/queries/facts';
import { formatDocNumber } from '@/lib/format/doc-number';
import { updateProjectCore } from '@/lib/projects/core';
import {
  TWO_SECTIONS,
  boqProposalWith,
  commitFromSnapshot,
  engagementAtBoq,
  rawEngagement,
  seedBoqOrg,
  type BoqOrg,
} from './boq-proposal-fixture';
import { closeFixture, raw, teardown } from './fixture';

// H3 round 2 (functional M1): a BOQ that goes under a delivery takes the
// DELIVERY's client, never the project's. A project's client can change while
// its delivery runs (the delivery keeps the client it was sold to); a BOQ made
// afterwards would otherwise carry the project's NEW client, so the delivery
// (app_delivery_boqs: only its own client's BOQs) stops owning it and the
// cockpit and the client home lose it. Both writers of `boqs.engagement_id`
// are covered: the sheet's Issue (the freeze hangs the BOQ on the delivery)
// and Send as BOQ (the BOQ is born on it). The contract generated from it
// takes the BOQ's client, so it is the delivery client's too.

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
    async (ctx: { orgId: string }, input: { detail: BoqDetail; engagementId: string; year: number }) => {
      const label = `${formatDocNumber('BQ', input.detail.number, input.year)}.pdf`;
      const [file] = await raw.query<{ id: string }>(
        `insert into public.files (org_id, entity, entity_id, object_key, original_name)
         values ('${ctx.orgId}', 'engagement', '${input.engagementId}', '${ctx.orgId}/engagement/' || gen_random_uuid(), '${label}')
         returning id`,
      );
      return { fileId: file.id, label };
    },
  );
});

/** The studio re-assigns the org's project to a new client, through the project sheet's core. */
async function reassignProjectClient(org: BoqOrg): Promise<string> {
  expect((await createClientCore(org.ctx, { phone: '01000000001', nameEn: 'Newco' })).ok).toBe(true);
  const [newClient] = await raw.query<{ id: string }>(
    `select id from public.clients where org_id = '${org.orgId}' and name_en = 'Newco'`,
  );
  const [project] = await raw.query<{ code: string }>(`select code from public.projects where id = '${org.projectId}'`);
  const updated = await updateProjectCore(org.ctx, {
    id: org.projectId,
    code: project.code,
    nameEn: 'Tower',
    clientId: newClient.id,
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    status: 'active',
  });
  expect(updated.ok).toBe(true);
  return newClient.id;
}

async function boqRow(boqId: string) {
  const [row] = await raw.query<{ client_id: string; engagement_id: string | null; status: string }>(
    `select client_id, engagement_id, status::text from public.boqs where id = '${boqId}'`,
  );
  return row;
}

async function deliveryOwns(org: BoqOrg, engagementId: string): Promise<string[]> {
  const rows = await raw.query<{ id: string }>(
    `select id from public.app_delivery_boqs('${engagementId}', '${org.orgId}')`,
  );
  return rows.map((row) => row.id);
}

describe('the sheet\'s Issue hangs a BOQ on the delivery as the delivery client\'s', () => {
  it('project moved to client B: the BOQ made for it is client A\'s once issued, the PDF names A, the cockpit and the contract follow', async () => {
    const org = await seedBoqOrg(orgIds);
    const deliveryId = await rawEngagement(org, 'execution');
    const newClientId = await reassignProjectClient(org);
    const boqId = (await createBoqCore(org.ctx, { projectId: org.projectId, titleEn: 'After the move' })).data!;
    expect((await boqRow(boqId)).client_id).toBe(newClientId);
    expect((await commitImportCore(org.ctx, {
      boqId,
      lines: [{ itemCode: '1', section: 'Works', description: 'Ceiling', unit: 'sqm', qty: '10', unitPrice: '100', unitCost: '0', costItemCode: null, provisional: false }],
    })).ok).toBe(true);

    expect((await issueBoqCore(org.ctx, { boqId, locale: 'en' })).ok).toBe(true);
    const names = (render.renderAndStoreClientBoqPdf.mock.calls[0][1] as { names: DocumentNames }).names;
    expect(names.clientEn).toBe('Acme');
    expect(await boqRow(boqId)).toEqual({ client_id: org.clientId, engagement_id: deliveryId, status: 'issued' });
    expect(await deliveryOwns(org, deliveryId)).toEqual([boqId]);
    const facts = await getExecutionFacts(org.ctx, deliveryId);
    expect(facts.boqId).toBe(boqId);
    expect(facts.flow.stage.hasIssuedBoq).toBe(true);

    const contract = await generateExecutionContractCore(org.ctx, { boqId, taxRate: '14', supervisionPct: '0' });
    expect(contract.ok).toBe(true);
    const [contractRow] = await raw.query<{ client_id: string }>(`select client_id from public.contracts where id = '${contract.data!}'`);
    expect(contractRow.client_id).toBe(org.clientId);
  });
});

describe('Send as BOQ makes the BOQ the delivery client\'s', () => {
  it('project moved to client B: the BOQ sent from the delivery\'s proposal is client A\'s and the delivery owns it', async () => {
    const org = await seedBoqOrg(orgIds);
    const deliveryId = await engagementAtBoq(org);
    await reassignProjectClient(org);
    const proposalId = await boqProposalWith(org.ctx, deliveryId, TWO_SECTIONS);
    const { result } = await commitFromSnapshot(org.ctx, org.orgId, proposalId);
    expect(result.ok).toBe(true);
    const boqId = result.data!.boqId;
    expect(await boqRow(boqId)).toEqual({ client_id: org.clientId, engagement_id: deliveryId, status: 'issued' });
    expect(await deliveryOwns(org, deliveryId)).toEqual([boqId]);
  });
});
