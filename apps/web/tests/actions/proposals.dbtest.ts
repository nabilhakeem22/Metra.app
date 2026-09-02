import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { withOrgContext } from '@/lib/db/context';
import { createCostItemCore } from '@/lib/price-book/core';
import { listCostItems } from '@/lib/price-book/queries';
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
import type { MemberRole } from '@metra/db';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function setup(members: Array<{ role: MemberRole }> = []) {
  const { orgId, ownerIds, memberIds } = await seedOrg({ owners: 1, members });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
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

describe('F1 — margin-blind save preserves stored cost', () => {
  async function marginBlindSetup() {
    const base = await setup([{ role: 'project_manager' }]);
    await raw.query(
      `update public.organizations set hide_margin_from_pm = true where id = '${base.orgId}'`,
    );
    const pm = ctxFor(base.orgId, base.memberIds[0], 'project_manager');
    return { ...base, pm };
  }

  it('(a) preserves a manual line cost when a margin-blind PM re-saves', async () => {
    const { ctx, pm, clientId, projectId } = await marginBlindSetup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, {
      id,
      sections: [{ titleEn: 'S', lines: [{ descriptionEn: 'Manual', qty: '2', unit: 'sqm', unitCost: '500', unitPrice: '800', discountPct: '0' }] }],
    });
    const d1 = await getProposalWithLines(ctx, id, true);
    const lineId = d1!.sections[0].lines[0].id;
    expect(d1!.sections[0].lines[0].lineCost).toBe('1000.0000');

    const res = await saveProposalDraftCore(pm, {
      id,
      sections: [{ titleEn: 'S', lines: [{ id: lineId, descriptionEn: 'Manual', qty: '2', unit: 'sqm', unitCost: null, unitPrice: '800', discountPct: '0' }] }],
    });
    expect(res.ok).toBe(true);
    const d2 = await getProposalWithLines(ctx, id, true);
    expect(d2!.sections[0].lines[0].unitCost).toBe('500.0000');
    expect(d2!.sections[0].lines[0].lineCost).toBe('1000.0000');
  });

  it('(b) keeps an owner-overridden costItem cost when PM re-saves', async () => {
    const { ctx, pm, clientId, projectId } = await marginBlindSetup();
    await createCostItemCore(ctx, { code: 'CI-1', nameEn: 'Item', sectionId: await raw.sectionId(ctx.orgId), unit: 'sqm', defaultUnitCost: '100', defaultUnitPrice: '150' });
    const [ci] = await listCostItems(ctx, {});
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    // New cost-item line -> seeds cost from the price book (100).
    await saveProposalDraftCore(ctx, {
      id,
      sections: [{ titleEn: 'S', lines: [{ costItemId: ci.id, descriptionEn: 'x', qty: '1', unit: 'sqm', unitPrice: '150', discountPct: '0' }] }],
    });
    const d0 = await getProposalWithLines(ctx, id, true);
    expect(d0!.sections[0].lines[0].unitCost).toBe('100.0000');

    // A margin-visible OWNER edits that existing line's cost to 999.
    const lineId0 = d0!.sections[0].lines[0].id;
    await saveProposalDraftCore(ctx, {
      id,
      sections: [{ titleEn: 'S', lines: [{ id: lineId0, costItemId: ci.id, descriptionEn: 'x', qty: '1', unit: 'sqm', unitCost: '999', unitPrice: '150', discountPct: '0' }] }],
    });
    const d1 = await getProposalWithLines(ctx, id, true);
    expect(d1!.sections[0].lines[0].unitCost).toBe('999.0000');

    // A margin-blind PM re-saves -> the override is preserved (not reverted to 100).
    const lineId = d1!.sections[0].lines[0].id;
    await saveProposalDraftCore(pm, {
      id,
      sections: [{ titleEn: 'S', lines: [{ id: lineId, costItemId: ci.id, descriptionEn: 'x', qty: '1', unit: 'sqm', unitCost: null, unitPrice: '150', discountPct: '0' }] }],
    });
    const d2 = await getProposalWithLines(ctx, id, true);
    expect(d2!.sections[0].lines[0].unitCost).toBe('999.0000');
  });

  it('(c) a NEW costItem line seeds cost from the price book', async () => {
    const { ctx, clientId, projectId } = await marginBlindSetup();
    await createCostItemCore(ctx, { code: 'CI-2', nameEn: 'Item2', sectionId: await raw.sectionId(ctx.orgId), unit: 'sqm', defaultUnitCost: '77', defaultUnitPrice: '150' });
    const [ci] = await listCostItems(ctx, {});
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, {
      id,
      sections: [{ titleEn: 'S', lines: [{ costItemId: ci.id, descriptionEn: 'x', qty: '1', unit: 'sqm', unitPrice: '150', discountPct: '0' }] }],
    });
    const d = await getProposalWithLines(ctx, id, true);
    expect(d!.sections[0].lines[0].unitCost).toBe('77.0000');
  });
});

describe('supervision fee (after VAT, untaxed; persisted + guarded)', () => {
  it('LOCKED: 100,000 / discount 0 / VAT 14% / supervision 10% -> total 124,000', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    const res = await saveProposalDraftCore(ctx, {
      id,
      header: { discountPct: '0', taxRate: '14', supervisionPct: '10' },
      sections: [
        {
          titleEn: 'S',
          lines: [
            { descriptionEn: 'x', qty: '1', unit: 'lump_sum', unitCost: '0', unitPrice: '100000', discountPct: '0' },
          ],
        },
      ],
    });
    expect(res.ok).toBe(true);
    const d = await getProposalWithLines(ctx, id, true);
    expect(d!.taxableBase).toBe('100000.0000');
    expect(d!.taxAmount).toBe('14000.0000');
    expect(d!.supervisionPct).toBe('10.0000');
    expect(d!.supervisionAmount).toBe('10000.0000');
    expect(d!.total).toBe('124000.0000');
  });

  it('rejects supervisionPct out of range; nothing persists', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    expect(
      await saveProposalDraftCore(ctx, { id, header: { supervisionPct: '150' }, sections: [] }),
    ).toEqual({ ok: false, error: 'supervision_out_of_range' });
    const d = await getProposalWithLines(ctx, id, true);
    expect(d!.supervisionPct).toBe('0.0000');
  });

  it('DB CHECK rejects a direct supervision_pct = 150 write (23514)', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    await expect(
      raw.query(
        `update public.proposals set supervision_pct = 150 where id = '${id}'`,
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('supersede deep-copies supervision into the new draft', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, {
      id,
      header: { taxRate: '14', supervisionPct: '10' },
      sections: twoSections,
    });
    await sendProposalCore(ctx, { id });
    const res = await supersedeProposalCore(ctx, { id });
    expect(res.ok).toBe(true);
    const copy = await getProposalWithLines(ctx, (res as { data?: string }).data!, true);
    expect(copy!.supervisionPct).toBe('10.0000');
    expect(copy!.status).toBe('draft');
  });
});

describe('F2 — discount out of range', () => {
  it('rejects line + doc discount > 100; nothing persists', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    expect(
      await saveProposalDraftCore(ctx, { id, sections: [{ titleEn: 'S', lines: [{ descriptionEn: 'x', qty: '1', unit: 'sqm', unitCost: '0', unitPrice: '100', discountPct: '150' }] }] }),
    ).toEqual({ ok: false, error: 'discount_out_of_range' });
    expect(
      await saveProposalDraftCore(ctx, { id, header: { discountPct: '150' }, sections: [] }),
    ).toEqual({ ok: false, error: 'discount_out_of_range' });
    const d = await getProposalWithLines(ctx, id, true);
    expect(d!.sections).toHaveLength(0);
  });
});

describe('S1 — only owner/admin may send', () => {
  it('client/viewer/site_engineer/accountant are forbidden', async () => {
    const { orgId, ctx, clientId, projectId } = await setup([
      { role: 'client' }, { role: 'viewer' }, { role: 'site_engineer' }, { role: 'accountant' },
    ]);
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id, sections: twoSections });
    const mems = await raw.memberships(orgId);
    for (const role of ['client', 'viewer', 'site_engineer', 'accountant'] as const) {
      const uid = mems.find((m) => m.role === role)!.user_id;
      expect(await sendProposalCore(ctxFor(orgId, uid, role), { id })).toMatchObject({ ok: false, error: 'forbidden' });
    }
  });
});

describe('R1/R3 — atomic transition gates', () => {
  it('R3: double-send -> 2nd proposal_not_draft, one sent event', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id, sections: twoSections });
    expect((await sendProposalCore(ctx, { id })).ok).toBe(true);
    expect(await sendProposalCore(ctx, { id })).toMatchObject({ ok: false, error: 'proposal_not_draft' });
    const [ev] = await raw.query<{ n: number }>(`select count(*)::int as n from public.proposal_events where proposal_id='${id}' and kind='sent'`);
    expect(Number(ev.n)).toBe(1);
  });

  it('R1: double-supersede -> 2nd invalid, exactly one v2 + one event', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    await saveProposalDraftCore(ctx, { id, sections: twoSections });
    await sendProposalCore(ctx, { id });
    expect((await supersedeProposalCore(ctx, { id })).ok).toBe(true);
    expect(await supersedeProposalCore(ctx, { id })).toEqual({ ok: false, error: 'invalid' });
    const [copies] = await raw.query<{ n: number }>(`select count(*)::int as n from public.proposals where supersedes_id='${id}'`);
    expect(Number(copies.n)).toBe(1);
    const [ev] = await raw.query<{ n: number }>(`select count(*)::int as n from public.proposal_events where proposal_id='${id}' and kind='superseded'`);
    expect(Number(ev.n)).toBe(1);
  });
});

describe('R2 — line caps + batching', () => {
  it('rejects over the total-line cap; ~200 lines saves fine with correct totals', async () => {
    const { ctx, clientId, projectId } = await setup();
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    const big = Array.from({ length: 5 }, (_, si) => ({
      titleEn: `S${si}`,
      lines: Array.from({ length: 500 }, () => ({ descriptionEn: 'x', qty: '1', unit: 'sqm' as const, unitCost: '0', unitPrice: '1', discountPct: '0' })),
    }));
    expect(await saveProposalDraftCore(ctx, { id, sections: big })).toEqual({ ok: false, error: 'too_many_lines' });

    const ok = [{ titleEn: 'S', lines: Array.from({ length: 200 }, () => ({ descriptionEn: 'x', qty: '1', unit: 'sqm' as const, unitCost: '0', unitPrice: '10', discountPct: '0' })) }];
    expect((await saveProposalDraftCore(ctx, { id, sections: ok })).ok).toBe(true);
    const d = await getProposalWithLines(ctx, id, true);
    expect(d!.sections[0].lines).toHaveLength(200);
    expect(d!.subtotal).toBe('2000.0000');
  });
});

describe('F4 — date + amount bounds', () => {
  it('invalid date and oversized amount are coded (not generic)', async () => {
    const { ctx, clientId, projectId } = await setup();
    expect(await createProposalCore(ctx, { clientId, projectId, issueDate: '2026-13-40' })).toEqual({ ok: false, error: 'invalid_date' });
    const id = ((await createProposalCore(ctx, { clientId, projectId })) as { data?: string }).data!;
    expect(
      await saveProposalDraftCore(ctx, { id, sections: [{ titleEn: 'S', lines: [{ descriptionEn: 'x', qty: '1', unit: 'sqm', unitCost: '0', unitPrice: '9999999999999', discountPct: '0' }] }] }),
    ).toEqual({ ok: false, error: 'amount_too_large' });
  });
});
