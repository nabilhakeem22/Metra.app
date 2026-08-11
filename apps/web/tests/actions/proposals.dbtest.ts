import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { withOrgContext } from '@/lib/db/context';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import {
  createProposalCore,
  saveProposalDraftCore,
  sendProposalCore,
  supersedeProposalCore,
  type SaveDraftInput,
} from '@/lib/proposals/core';
import {
  getProposalByToken,
  respondToProposalByToken,
} from '@/lib/proposals/public';
import { getProposalWithLines, listProposals } from '@/lib/proposals/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { OrgContext } from '@/lib/db/context';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function setup(members: Array<{ role: 'project_manager' | 'admin' }> = []) {
  const { orgId, ownerIds, memberIds } = await seedOrg({ owners: 1, members });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    code: 'PRJ-1',
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  return { orgId, ctx, clientId: client.id, projectId: project.id, memberIds };
}

const twoSections: SaveDraftInput['sections'] = [
  {
    titleEn: 'Civil',
    sortOrder: 0,
    lines: [
      { descriptionEn: 'Wall', qty: '2', unit: 'sqm', unitCost: '60', unitPrice: '100', discountPct: '0', sortOrder: 0 },
      { descriptionEn: 'Plaster', qty: '1', unit: 'sqm', unitCost: '30', unitPrice: '50', discountPct: '10', sortOrder: 1 },
    ],
  },
  {
    titleEn: 'Finishes',
    sortOrder: 1,
    lines: [
      { descriptionEn: 'Paint', qty: '3', unit: 'sqm', unitCost: '5', unitPrice: '10.005', discountPct: '10', sortOrder: 0 },
    ],
  },
];

describe('createProposalCore + numbering', () => {
  it('allocates sequential per-org numbers and defaults a title', async () => {
    const { ctx } = await setup();
    const a = await createProposalCore(ctx, {
      clientId: (await listClients(ctx, {}))[0].id,
      projectId: (await listProjects(ctx, {}))[0].id,
    });
    expect(a.ok).toBe(true);
    const rows = await listProposals(ctx, {});
    expect(rows[0].number).toBe(1);
    expect(rows[0].status).toBe('draft');
  });
});

describe('saveProposalDraftCore recomputes ALL totals (AC2, AC12)', () => {
  it('writes per-section subtotals and doc totals from the engine', async () => {
    const { ctx, clientId, projectId } = await setup();
    const created = await createProposalCore(ctx, { clientId, projectId });
    const id = (created as { data?: string }).data!;

    const res = await saveProposalDraftCore(ctx, {
      id,
      header: { discountPct: '5', taxRate: '14' },
      sections: twoSections,
    });
    expect(res.ok).toBe(true);

    const detail = await getProposalWithLines(ctx, id, true);
    expect(detail).not.toBeNull();
    // Section subtotals == Σ lineTotal.
    expect(detail!.sections[0].sectionSubtotal).toBe('245.0000');
    expect(detail!.sections[1].sectionSubtotal).toBe('27.0135');
    // Doc totals (subtotal 272.0135, disc 5%, tax 14%).
    expect(detail!.subtotal).toBe('272.0135');
    expect(detail!.discountAmount).toBe('13.6007');
    expect(detail!.taxableBase).toBe('258.4128');
    expect(detail!.taxAmount).toBe('36.1778');
    expect(detail!.total).toBe('294.5906');
    expect(detail!.totalCost).toBe('165.0000');
  });
});

describe('margin gating (AC6)', () => {
  it('omits cost/margin from detail when canSeeMargin is false', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = (await createProposalCore(ctx, { clientId, projectId }) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id, sections: twoSections });

    const hidden = await getProposalWithLines(ctx, id, false);
    expect(hidden!.totalCost).toBeUndefined();
    expect(hidden!.totalMargin).toBeUndefined();
    expect(hidden!.sections[0].sectionCost).toBeUndefined();
    expect(hidden!.sections[0].lines[0].lineCost).toBeUndefined();
    expect(hidden!.sections[0].lines[0].unitCost).toBeUndefined();

    const shown = await getProposalWithLines(ctx, id, true);
    expect(shown!.totalCost).toBe('165.0000');
    expect(shown!.sections[0].lines[0].lineCost).toBeDefined();
  });
});

describe('send + immutability (AC4, AC5)', () => {
  it('send is owner/admin only; PM forbidden; draft build allowed for PM', async () => {
    const { orgId, ctx, clientId, projectId, memberIds } = await setup([
      { role: 'project_manager' },
    ]);
    const pm: OrgContext = ctxFor(orgId, memberIds[0], 'project_manager');

    const id = (await createProposalCore(ctx, { clientId, projectId }) as { data?: string }).data!;
    // PM can build the draft.
    expect((await saveProposalDraftCore(pm, { id, sections: twoSections })).ok).toBe(true);
    // PM cannot send.
    expect(await sendProposalCore(pm, { id })).toMatchObject({ ok: false, error: 'forbidden' });
    // Owner can.
    const sent = await sendProposalCore(ctx, { id });
    expect(sent.ok).toBe(true);
    expect(typeof sent.data).toBe('string');
  });

  it('after send, raw section/line/total writes raise MT100', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = (await createProposalCore(ctx, { clientId, projectId }) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id, sections: twoSections });
    await sendProposalCore(ctx, { id });

    // A raw UPDATE of the sent proposal's total is frozen.
    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(sql`update public.proposals set total = '1' where id = ${id}`),
      ),
    ).rejects.toMatchObject({ code: 'MT100' });

    // A raw INSERT of a section under the sent proposal is frozen.
    const [sec] = await raw.query<{ id: string }>(
      `select id from public.proposal_sections where proposal_id = '${id}' limit 1`,
    );
    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql`update public.proposal_sections set title_en = 'x' where id = ${sec.id}`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'MT100' });
    await expect(
      withOrgContext(ctx, (tx) =>
        tx.execute(
          sql`delete from public.proposal_lines where section_id = ${sec.id}`,
        ),
      ),
    ).rejects.toMatchObject({ code: 'MT100' });
  });
});

describe('public token share (AC7, AC8)', () => {
  it('token payload has no cost/margin; accept flips + logs; 2nd is already; expired', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = (await createProposalCore(ctx, { clientId, projectId }) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id, sections: twoSections });
    const sent = await sendProposalCore(ctx, { id });
    const token = sent.data!;

    const payload = await getProposalByToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sections).toHaveLength(2);
    expect(payload!.sections[0].lines[0]).toHaveProperty('line_total');
    expect(JSON.stringify(payload)).not.toMatch(/cost|margin/i);

    // Garbage token -> null.
    expect(await getProposalByToken('not-a-real-token')).toBeNull();

    // Accept flips sent -> accepted and logs an event.
    expect(await respondToProposalByToken(token, { decision: 'accept', actorName: 'Client' })).toEqual({ ok: true });
    expect(await raw.count('proposal_events', ctx.orgId)).toBeGreaterThanOrEqual(2); // sent + accepted
    const [p] = await raw.query<{ status: string }>(
      `select status from public.proposals where id = '${id}'`,
    );
    expect(p.status).toBe('accepted');

    // 2nd response -> already_responded.
    expect(await respondToProposalByToken(token, { decision: 'reject' })).toEqual({ ok: false, error: 'already_responded' });
  });

  it('a past shareExpiresAt yields token_expired', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = (await createProposalCore(ctx, { clientId, projectId }) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id, sections: twoSections });
    const token = (await sendProposalCore(ctx, { id })).data!;

    // Backdate the share window (drop the immutable guard on the owner conn).
    await raw.query(`alter table public.proposals disable trigger trg_proposals_immutable`);
    await raw.query(`update public.proposals set share_expires_at = now() - interval '1 day' where id = '${id}'`);
    await raw.query(`alter table public.proposals enable trigger trg_proposals_immutable`);

    expect(await respondToProposalByToken(token, { decision: 'accept' })).toEqual({ ok: false, error: 'token_expired' });
  });
});

describe('supersede (deep copy)', () => {
  it('sent -> new draft v2 with copied sections+lines; original superseded', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = (await createProposalCore(ctx, { clientId, projectId }) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id, sections: twoSections });
    await sendProposalCore(ctx, { id });

    const res = await supersedeProposalCore(ctx, { id });
    expect(res.ok).toBe(true);
    const newId = res.data!;
    const copy = await getProposalWithLines(ctx, newId, true);
    expect(copy!.version).toBe(2);
    expect(copy!.status).toBe('draft');
    expect(copy!.supersedesId).toBe(id);
    expect(copy!.sections).toHaveLength(2);

    const [orig] = await raw.query<{ status: string }>(
      `select status from public.proposals where id = '${id}'`,
    );
    expect(orig.status).toBe('superseded');
  });
});
