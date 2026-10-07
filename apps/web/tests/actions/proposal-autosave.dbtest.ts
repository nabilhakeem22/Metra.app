// Round B, B6 fix round: the draft save as an autosaving builder uses it.
//  R1/R6/R9  concurrent saves of one draft serialise on the proposal row lock;
//            a save from a stale revision is refused draft_changed_elsewhere.
//  F1        the save's receipt names every stored line, so a line added this
//            session is a stored line from its first save; an owner's cost
//            override on a new price-book line survives every save.
//  R4        one audit row per draft per five minutes of saving.
//  S1        a malformed payload is `invalid` at the boundary.
import { afterAll, describe, expect, it } from 'vitest';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { createCostItemCore } from '@/lib/price-book/core';
import { listCostItems } from '@/lib/price-book/queries';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import {
  createProposalCore,
  deleteDraftProposalCore,
  saveProposalDraftCore,
  type SaveDraftInput,
} from '@/lib/proposals/core';
import { getProposalWithLines } from '@/lib/proposals/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function setup(): Promise<{ ctx: OrgContext; pm: OrgContext; orgId: string; id: string }> {
  const { orgId, ownerIds, memberIds } = await seedOrg({ owners: 1, members: [{ role: 'project_manager' }] });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  const pm = ctxFor(orgId, memberIds[0], 'project_manager');
  await raw.query(`update public.organizations set hide_margin_from_pm = true where id = '${orgId}'`);
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    startDate: '2026-01-01',
    endDate: '2026-06-30',
    code: 'PRJ-1',
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  const created = await createProposalCore(ctx, { clientId: client.id, projectId: project.id });
  return { ctx, pm, orgId, id: (created as { data?: string }).data! };
}

type Line = SaveDraftInput['sections'][number]['lines'][number];

function lines(count: number, tag: string, price: string, ids: (string | undefined)[] = []): Line[] {
  return Array.from({ length: count }, (_, index) => ({
    id: ids[index],
    descriptionEn: `${tag} line ${index}`,
    qty: '1',
    unit: 'sqm' as const,
    unitCost: '100',
    unitPrice: price,
    discountPct: '0',
  }));
}

async function documentState(id: string) {
  const [row] = await raw.query<{ sections: number; lines: number; sum: string; subtotal: string }>(
    `select (select count(*)::int from public.proposal_sections where proposal_id = '${id}') as sections,
            (select count(*)::int from public.proposal_lines where proposal_id = '${id}') as lines,
            (select coalesce(sum(line_total), 0)::text from public.proposal_lines where proposal_id = '${id}') as sum,
            (select subtotal::text from public.proposals where id = '${id}') as subtotal`,
  );
  return row;
}

describe('the save receipt (F1)', () => {
  it('names each stored section and line in the order sent, with the new revision', async () => {
    const { ctx, id } = await setup();
    const loaded = (await getProposalWithLines(ctx, id, true))!;
    const saved = await saveProposalDraftCore(ctx, {
      id,
      revision: loaded.revision,
      sections: [{ titleEn: 'A', lines: lines(2, 'a', '10') }, { titleEn: 'B', lines: lines(1, 'b', '20') }],
    });
    expect(saved.ok).toBe(true);
    const receipt = saved.data!;
    expect(receipt.revision).not.toBe(loaded.revision);
    const stored = (await getProposalWithLines(ctx, id, true))!;
    expect(stored.revision).toBe(receipt.revision);
    expect(receipt.sections.map((section) => section.id)).toEqual(stored.sections.map((section) => section.id));
    expect(receipt.sections.map((section) => section.lineIds)).toEqual(
      stored.sections.map((section) => section.lines.map((line) => line.id)),
    );
  });

  it('an owner override (150) on a NEW price-book line (100) survives three autosaves', async () => {
    const { ctx, id } = await setup();
    await createCostItemCore(ctx, {
      code: 'CI-M',
      nameEn: 'Marble',
      sectionId: await raw.sectionId(ctx.orgId),
      unit: 'sqm',
      defaultUnitCost: '100',
      defaultUnitPrice: '200',
    });
    const [marble] = await listCostItems(ctx, {});
    let revision = (await getProposalWithLines(ctx, id, true))!.revision;
    let lineId: string | undefined;
    for (const qty of ['1', '2', '3']) {
      const saved = await saveProposalDraftCore(ctx, {
        id,
        revision,
        sections: [{
          titleEn: 'S',
          lines: [{ id: lineId, costItemId: marble.id, descriptionEn: 'Marble', qty, unit: 'sqm', unitCost: '150', unitPrice: '200', discountPct: '0' }],
        }],
      });
      expect(saved.ok).toBe(true);
      revision = saved.data!.revision;
      lineId = saved.data!.sections[0].lineIds[0];
      const [stored] = (await getProposalWithLines(ctx, id, true))!.sections[0].lines;
      expect(stored.id).toBe(lineId);
      expect(stored.unitCost).toBe('150.0000');
    }
  });

  it('a margin-blind PM adding a price-book line gets the price-book cost, whatever it sends', async () => {
    const { ctx, pm, id } = await setup();
    await createCostItemCore(ctx, {
      code: 'CI-P',
      nameEn: 'Paint',
      sectionId: await raw.sectionId(ctx.orgId),
      unit: 'sqm',
      defaultUnitCost: '100',
      defaultUnitPrice: '200',
    });
    const [paint] = await listCostItems(ctx, {});
    const saved = await saveProposalDraftCore(pm, {
      id,
      sections: [{ titleEn: 'S', lines: [{ costItemId: paint.id, descriptionEn: 'Paint', qty: '1', unit: 'sqm', unitCost: '1', unitPrice: '200', discountPct: '0' }] }],
    });
    expect(saved.ok).toBe(true);
    expect((await getProposalWithLines(ctx, id, true))!.sections[0].lines[0].unitCost).toBe('100.0000');
  });
});

describe('one writer at a time (R1, R6, R9)', () => {
  it('a save from a stale revision is refused and changes nothing', async () => {
    const { ctx, id } = await setup();
    const loaded = (await getProposalWithLines(ctx, id, true))!.revision;
    expect((await saveProposalDraftCore(ctx, { id, revision: loaded, sections: [{ titleEn: 'A', lines: lines(2, 'a', '10') }] })).ok).toBe(true);
    const before = await documentState(id);
    const stale = await saveProposalDraftCore(ctx, { id, revision: loaded, sections: [{ titleEn: 'B', lines: lines(5, 'b', '99') }] });
    expect(stale).toEqual({ ok: false, error: 'draft_changed_elsewhere' });
    expect(await documentState(id)).toEqual(before);
  });

  it('two concurrent saves of one draft never double it (5 trials, new and kept ids)', async () => {
    for (let trial = 0; trial < 5; trial += 1) {
      const { ctx, id } = await setup();
      const first = await saveProposalDraftCore(ctx, { id, sections: [{ titleEn: 'A', lines: lines(30, 'a', '10') }] });
      const kept = first.data!.sections[0].lineIds;
      const [a, b] = await Promise.all([
        saveProposalDraftCore(ctx, { id, sections: [{ titleEn: 'A', lines: lines(30, 'a', '11', trial % 2 ? kept : []) }] }),
        saveProposalDraftCore(ctx, { id, sections: [{ titleEn: 'B', lines: lines(30, 'b', '12') }] }),
      ]);
      expect(a.ok && b.ok).toBe(true);
      const state = await documentState(id);
      expect(state.sections).toBe(1);
      expect(state.lines).toBe(30);
      expect(Number(state.sum)).toBe(Number(state.subtotal));
    }
  });

  it('two tabs from one revision: one wins, the other is told, the draft is whole', async () => {
    const { ctx, id } = await setup();
    const loaded = (await getProposalWithLines(ctx, id, true))!.revision;
    const results = await Promise.all([
      saveProposalDraftCore(ctx, { id, revision: loaded, sections: [{ titleEn: 'A', lines: lines(20, 'a', '10') }] }),
      saveProposalDraftCore(ctx, { id, revision: loaded, sections: [{ titleEn: 'B', lines: lines(20, 'b', '20') }] }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'draft_changed_elsewhere' }]);
    const state = await documentState(id);
    expect(state.lines).toBe(20);
    expect(Number(state.sum)).toBe(Number(state.subtotal));
  });

  it('a save racing a delete of the draft answers a code, never a defect', async () => {
    const { ctx, id } = await setup();
    await saveProposalDraftCore(ctx, { id, sections: [{ titleEn: 'A', lines: lines(20, 'a', '10') }] });
    const [save, removal] = await Promise.all([
      saveProposalDraftCore(ctx, { id, sections: [{ titleEn: 'A', lines: lines(20, 'a', '11') }] }),
      deleteDraftProposalCore(ctx, { id }),
    ]);
    expect(removal.ok).toBe(true);
    expect(save.ok ? 'ok' : save.error).toMatch(/^(ok|invalid)$/);
    expect(await documentState(id)).toMatchObject({ sections: 0, lines: 0 });
  });
});

describe('proportionate audit (R4) and the payload boundary (S1)', () => {
  it('many saves within five minutes leave one audit row', async () => {
    const { ctx, id } = await setup();
    for (const price of ['10', '11', '12', '13']) {
      expect((await saveProposalDraftCore(ctx, { id, sections: [{ titleEn: 'A', lines: lines(1, 'a', price) }] })).ok).toBe(true);
    }
    const [row] = await raw.query<{ count: number }>(
      `select count(*)::int as count from public.audit_log
        where entity = 'proposal' and entity_id = '${id}' and action = 'update'`,
    );
    expect(Number(row.count)).toBe(1);
  });

  it('a non-string line id is invalid at the boundary, not a TypeError', async () => {
    const { ctx, id } = await setup();
    const odd = { ...lines(1, 'a', '10')[0], id: { toString: () => 'x' } } as unknown as Line;
    expect(await saveProposalDraftCore(ctx, { id, sections: [{ titleEn: 'A', lines: [odd] }] })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});
