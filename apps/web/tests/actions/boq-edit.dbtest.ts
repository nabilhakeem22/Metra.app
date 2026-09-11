import { afterAll, describe, expect, it } from 'vitest';
import { commitImportCore, createBoqCore } from '@/lib/boqs/core';
import {
  addBoqLineCore,
  addBoqSectionCore,
  deleteBoqLineCore,
  setBoqDiscountCore,
  updateBoqLineCore,
} from '@/lib/boqs/edit';
import { getProjectBoq } from '@/lib/boqs/queries';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

/** An org with one project and one imported two-line BOQ, ready to be edited. */
async function setup(): Promise<{
  ctx: OrgContext;
  blindCtx: OrgContext;
  projectId: string;
}> {
  const { orgId, ownerIds, memberIds } = await seedOrg({
    owners: 1,
    members: [{ role: 'site_engineer' }],
  });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  const blindCtx = ctxFor(orgId, memberIds[0], 'site_engineer');

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
  const created = await createBoqCore(ctx, {
    projectId: project.id,
    titleEn: 'Bill of Quantities',
  });
  const boqId = (created as { data?: string }).data!;

  await commitImportCore(ctx, {
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
      {
        itemCode: '2.02',
        section: 'Gypsum works',
        description: 'Gypsum cornice',
        unit: 'linear_meter',
        qty: '45',
        unitPrice: '220',
        unitCost: '0',
        costItemCode: null,
        provisional: false,
      },
    ],
  });
  return { ctx, blindCtx, projectId: project.id };
}

const read = (ctx: OrgContext, projectId: string) =>
  getProjectBoq(ctx, projectId, { showCost: true });

describe('editing a draft BOQ', () => {
  it('re-rolls the section subtotal and the document total on every write', async () => {
    const { ctx, projectId } = await setup();
    const before = await read(ctx, projectId);
    // 100*1500 + 45*220 = 159,900
    expect(Number(before!.total)).toBe(159900);

    const line = before!.sections[0].lines[0];
    const res = await updateBoqLineCore(ctx, {
      lineId: line.id,
      patch: { qty: '120' },
    });
    expect(res.ok).toBe(true);

    const after = await read(ctx, projectId);
    // 120*1500 + 45*220 = 189,900 — and the SECTION subtotal moves with it.
    expect(Number(after!.total)).toBe(189900);
    expect(Number(after!.sections[0].sectionSubtotal)).toBe(189900);
    expect(Number(after!.sections[0].lines[0].lineTotal)).toBe(180000);
  });

  it('leaves the columns the patch did not name alone', async () => {
    const { ctx, projectId } = await setup();
    const line = (await read(ctx, projectId))!.sections[0].lines[0];

    await updateBoqLineCore(ctx, { lineId: line.id, patch: { itemCode: '9.99' } });

    const after = (await read(ctx, projectId))!.sections[0].lines[0];
    expect(after.itemCode).toBe('9.99');
    expect(after.description).toBe(line.description);
    expect(after.unit).toBe(line.unit);
    expect(Number(after.qty)).toBe(Number(line.qty));
    expect(Number(after.unitPrice)).toBe(Number(line.unitPrice));
  });

  it('refuses a typo rather than reading it as zero', async () => {
    const { ctx, projectId } = await setup();
    const line = (await read(ctx, projectId))!.sections[0].lines[0];

    const res = await updateBoqLineCore(ctx, {
      lineId: line.id,
      patch: { unitPrice: '1,5OO' },
    });
    expect(res).toEqual({ ok: false, error: 'invalid_price' });

    // The rate — and therefore the document total — is untouched.
    const after = await read(ctx, projectId);
    expect(Number(after!.sections[0].lines[0].unitPrice)).toBe(1500);
    expect(Number(after!.total)).toBe(159900);
  });

  it('refuses a negative quantity', async () => {
    const { ctx, projectId } = await setup();
    const line = (await read(ctx, projectId))!.sections[0].lines[0];
    expect(
      await updateBoqLineCore(ctx, { lineId: line.id, patch: { qty: '-5' } }),
    ).toEqual({ ok: false, error: 'invalid_qty' });
  });

  it('reads the separators a studio actually types', async () => {
    const { ctx, projectId } = await setup();
    const line = (await read(ctx, projectId))!.sections[0].lines[0];

    expect(
      (await updateBoqLineCore(ctx, {
        lineId: line.id,
        patch: { unitPrice: '1,750.50' },
      })).ok,
    ).toBe(true);

    const after = await read(ctx, projectId);
    expect(Number(after!.sections[0].lines[0].unitPrice)).toBe(1750.5);
  });

  it('adds and deletes a line, re-rolling both times', async () => {
    const { ctx, projectId } = await setup();
    const sectionId = (await read(ctx, projectId))!.sections[0].id;

    const added = await addBoqLineCore(ctx, { sectionId, description: 'New line' });
    expect(added.ok).toBe(true);
    const newId = (added as { data?: string }).data!;

    // A blank line is worth nothing, so the total must NOT move.
    let now = await read(ctx, projectId);
    expect(now!.lineCount).toBe(3);
    expect(Number(now!.total)).toBe(159900);

    await updateBoqLineCore(ctx, {
      lineId: newId,
      patch: { qty: '2', unitPrice: '50', unit: 'pcs' },
    });
    now = await read(ctx, projectId);
    expect(Number(now!.total)).toBe(160000);

    expect((await deleteBoqLineCore(ctx, { lineId: newId })).ok).toBe(true);
    now = await read(ctx, projectId);
    expect(now!.lineCount).toBe(2);
    expect(Number(now!.total)).toBe(159900);
  });

  it('discounts the document off the subtotal', async () => {
    const { ctx, projectId } = await setup();
    const boqId = (await read(ctx, projectId))!.id;

    expect((await setBoqDiscountCore(ctx, { boqId, discountPct: '10' })).ok).toBe(
      true,
    );
    const after = await read(ctx, projectId);
    expect(Number(after!.subtotal)).toBe(159900);
    expect(Number(after!.discountAmount)).toBe(15990);
    expect(Number(after!.total)).toBe(143910);
  });

  it('refuses a discount above 100', async () => {
    const { ctx, projectId } = await setup();
    const boqId = (await read(ctx, projectId))!.id;
    expect(await setBoqDiscountCore(ctx, { boqId, discountPct: '140' })).toEqual({
      ok: false,
      error: 'invalid_discount',
    });
  });

  it('adds a section, so a hand-built BOQ has somewhere to put a line', async () => {
    const { ctx, projectId } = await setup();
    const boqId = (await read(ctx, projectId))!.id;

    const added = await addBoqSectionCore(ctx, { boqId, title: 'Painting' });
    expect(added.ok).toBe(true);

    const after = await read(ctx, projectId);
    expect(after!.sections.map((s) => s.title)).toContain('Painting');
  });

  it('routes an Arabic description to the Arabic column', async () => {
    const { ctx, projectId } = await setup();
    const line = (await read(ctx, projectId))!.sections[0].lines[0];

    await updateBoqLineCore(ctx, {
      lineId: line.id,
      patch: { description: 'سقف جبس 12 مم' },
    });

    const [row] = await raw.query<{ ar: string | null; en: string | null }>(
      `select description_ar as ar, description_en as en
         from public.boq_lines where id = '${line.id}'`,
    );
    expect(row.ar).toBe('سقف جبس 12 مم');
    // The English side is CLEARED rather than left carrying superseded text.
    expect(row.en).toBeNull();
  });
});

describe('the freeze rule', () => {
  it('refuses every edit once the BOQ is issued', async () => {
    const { ctx, projectId } = await setup();
    const boq = (await read(ctx, projectId))!;
    const line = boq.sections[0].lines[0];
    const sectionId = boq.sections[0].id;

    // Frozen directly: issueBoqCore renders a PDF through Chromium, which is not
    // what this test is about.
    await raw.query(
      `update public.boqs set status = 'issued' where id = '${boq.id}'`,
    );

    expect(
      await updateBoqLineCore(ctx, { lineId: line.id, patch: { qty: '5' } }),
    ).toEqual({ ok: false, error: 'boq_not_draft' });
    expect(await addBoqLineCore(ctx, { sectionId, description: 'Sneaky' })).toEqual(
      { ok: false, error: 'boq_not_draft' },
    );
    expect(await deleteBoqLineCore(ctx, { lineId: line.id })).toEqual({
      ok: false,
      error: 'boq_not_draft',
    });
    expect(await addBoqSectionCore(ctx, { boqId: boq.id, title: 'Late' })).toEqual({
      ok: false,
      error: 'boq_not_draft',
    });
    expect(
      await setBoqDiscountCore(ctx, { boqId: boq.id, discountPct: '50' }),
    ).toEqual({ ok: false, error: 'boq_not_draft' });

    // Nothing moved.
    const after = await read(ctx, projectId);
    expect(Number(after!.total)).toBe(159900);
    expect(after!.lineCount).toBe(2);
  });
});

describe('the capability', () => {
  it('refuses a role without boq_build', async () => {
    const { ctx, blindCtx, projectId } = await setup();
    const boq = (await read(ctx, projectId))!;
    const line = boq.sections[0].lines[0];

    expect(
      await updateBoqLineCore(blindCtx, { lineId: line.id, patch: { qty: '5' } }),
    ).toEqual({ ok: false, error: 'forbidden' });
    expect(await deleteBoqLineCore(blindCtx, { lineId: line.id })).toEqual({
      ok: false,
      error: 'forbidden',
    });
  });
});
