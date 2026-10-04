// Shared setup for the BOQ-proposal database suites. Not a test file: it is
// imported by `boq-proposals*.dbtest.ts` and runs inside their runner.
import { expect } from 'vitest';
import { commitProposalBoqCore } from '@/lib/boq-proposals/core/commit';
import { openBoqProposalCore } from '@/lib/boq-proposals/core/open';
import { mapProposalToBoq } from '@/lib/boq-proposals/map';
import { loadSendSnapshot } from '@/lib/boq-proposals/snapshot';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { recordRomAcknowledgementCore } from '@/lib/engagements/approvals';
import { recordArtifactCore } from '@/lib/engagements/artifacts';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { recordPaymentCore } from '@/lib/engagements/payments';
import { setEngagementRomCore } from '@/lib/engagements/rom';
import { issueRomCore } from '@/lib/engagements/rom-issue';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { saveProposalDraftCore, type SaveDraftInput } from '@/lib/proposals/core';
import { ctxFor, raw, seedOrg } from './fixture';

export interface BoqOrg {
  orgId: string;
  ctx: OrgContext;
  pmCtx: OrgContext;
  viewerCtx: OrgContext;
  siteCtx: OrgContext;
  clientId: string;
  projectId: string;
}

/** An org (owner, PM, viewer, site engineer) with one client and one project. */
export async function seedBoqOrg(orgIds: string[]): Promise<BoqOrg> {
  const { orgId, ownerIds, memberIds } = await seedOrg({
    owners: 1,
    members: [{ role: 'project_manager' }, { role: 'viewer' }, { role: 'site_engineer' }],
  });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    code: `PRJ-${orgId.slice(0, 8)}`,
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  return {
    orgId,
    ctx,
    pmCtx: ctxFor(orgId, memberIds[0], 'project_manager'),
    viewerCtx: ctxFor(orgId, memberIds[1], 'viewer'),
    siteCtx: ctxFor(orgId, memberIds[2], 'site_engineer'),
    clientId: client.id,
    projectId: project.id,
  };
}

/** A bare engagement row (state `created`), for suites that need no fee walk. */
export async function rawEngagement(org: BoqOrg, state = 'created'): Promise<string> {
  const [row] = await raw.query<{ id: string }>(
    `insert into public.design_engagements (org_id, number, client_id, project_id, title_en, state)
     values ('${org.orgId}',
             (select coalesce(max(number), 0) + 1 from public.design_engagements
               where org_id = '${org.orgId}'),
             '${org.clientId}', '${org.projectId}', 'Fit-out design', '${state}')
     returning id`,
  );
  return row.id;
}

/**
 * A real engagement walked to state `boq` through the executor, exactly as
 * `engagements-finalize-boq.dbtest.ts` does. Every milestone but the balance is
 * paid, so the portal still withholds a `boq`.
 */
export async function engagementAtBoq(org: BoqOrg): Promise<string> {
  const { ctx } = org;
  const created = await createEngagementCore(ctx, {
    titleEn: 'Villa fit-out',
    clientId: org.clientId,
    projectId: org.projectId,
  });
  const engagementId = (created as { data?: string }).data!;
  const fire = async (trigger: string, payload?: unknown) =>
    expect(
      (await executeTransition(ctx, { engagementId, trigger, payload } as Parameters<
        typeof executeTransition
      >[1])).ok,
    ).toBe(true);
  await fire('submitDesignFee', {
    designFee: '100000',
    milestones: [
      { kind: 'deposit', basis: 'amount', value: '30000' },
      { kind: 'gate_a', basis: 'amount', value: '20000' },
      { kind: 'gate_b', basis: 'amount', value: '20000' },
      { kind: 'balance', basis: 'amount', value: '30000' },
    ],
  });
  await recordPaymentCore(ctx, { engagementId, kind: 'deposit', amount: '30000' });
  await fire('confirmAndPayDeposit');
  await recordArtifactCore(ctx, { engagementId, kind: 'survey' });
  await fire('spatialBaseReady');
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'A' });
  await recordArtifactCore(ctx, { engagementId, kind: 'concept_option', label: 'B' });
  await fire('optionsReady');
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_a', amount: '20000' });
  await fire('selectConcept');
  await fire('confirmConcept');
  await recordArtifactCore(ctx, { engagementId, kind: 'approved_render', contentHash: 'h' });
  await fire('rendersReady');
  await setEngagementRomCore(ctx, { engagementId, romLow: '500000', romHigh: '800000' });
  expect((await issueRomCore(ctx, { engagementId })).ok).toBe(true);
  await recordRomAcknowledgementCore(ctx, { engagementId });
  await recordPaymentCore(ctx, { engagementId, kind: 'gate_b', amount: '20000' });
  await fire('approveDesign');
  await recordArtifactCore(ctx, { engagementId, kind: 'shop_drawing' });
  await fire('draftReady');
  return engagementId;
}

export const TWO_SECTIONS: SaveDraftInput['sections'] = [
  {
    titleEn: 'Ceilings',
    lines: [
      { descriptionEn: 'Gypsum ceiling', qty: '100', unit: 'sqm', unitCost: '900', unitPrice: '1500', discountPct: '0' },
      { descriptionEn: 'Cornice', qty: '45', unit: 'linear_meter', unitCost: '120', unitPrice: '220', discountPct: '10' },
    ],
  },
  { titleEn: 'Empty, dropped on send', lines: [] },
  {
    titleEn: 'Paint',
    lines: [
      { descriptionEn: 'Emulsion', qty: '300', unit: 'sqm', unitCost: '30', unitPrice: '55.5', discountPct: '0' },
    ],
  },
];

/** Open the engagement's BOQ proposal and save `sections` into it. */
export async function boqProposalWith(
  ctx: OrgContext,
  engagementId: string,
  sections: SaveDraftInput['sections'],
  header: SaveDraftInput['header'] = { discountPct: '5' },
): Promise<string> {
  const opened = await openBoqProposalCore(ctx, { engagementId });
  expect(opened.ok).toBe(true);
  const proposalId = opened.data!;
  expect((await saveProposalDraftCore(ctx, { id: proposalId, header, sections })).ok).toBe(
    true,
  );
  return proposalId;
}

/** A stored `files` row standing in for the rendered PDF (no Chromium here). */
export async function fakePdf(orgId: string, engagementId: string): Promise<string> {
  const [file] = await raw.query<{ id: string }>(
    `insert into public.files (org_id, entity, entity_id, object_key, original_name)
     values ('${orgId}', 'engagement', '${engagementId}',
             '${orgId}/engagement/' || gen_random_uuid(), 'BQ.pdf')
     returning id`,
  );
  return file.id;
}

/**
 * Send as BOQ minus the render: the real snapshot, the real mapper, a stored
 * file row, and the real commit. `adjust` runs between the snapshot and the
 * commit, so a case can move the world under it (or stale one fence).
 */
export async function commitFromSnapshot(
  ctx: OrgContext,
  orgId: string,
  proposalId: string,
  adjust: (input: Parameters<typeof commitProposalBoqCore>[1]) => void | Promise<void> = () => {},
) {
  const snapshot = await loadSendSnapshot(ctx, proposalId);
  if (typeof snapshot === 'string') throw new Error(`snapshot refused: ${snapshot}`);
  const mapped = mapProposalToBoq(snapshot.source, snapshot.proposal.discountPct);
  const { id, revision, ...header } = snapshot.proposal;
  const input = {
    proposalId: id,
    expectedRevision: revision,
    expectedNumber: snapshot.nextBoqNumber,
    expectedYear: snapshot.renderYear,
    engagement: snapshot.engagement,
    header,
    mapped,
    file: { fileId: await fakePdf(orgId, snapshot.engagement.id), label: 'BQ.pdf' },
  };
  await adjust(input);
  return { result: await commitProposalBoqCore(ctx, input), snapshot, mapped };
}
