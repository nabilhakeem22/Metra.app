import { afterAll, describe, expect, it } from 'vitest';
import {
  computeSection,
  parseMoney4,
} from '@/lib/aggregates/proposal-totals';
import { commitImportCore, createBoqCore } from '@/lib/boqs/core';
import { deleteBoqLineCore } from '@/lib/boqs/edit';
import { getProjectBoq } from '@/lib/boqs/queries';
import { computeBoqTotals } from '@/lib/boqs/totals';
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

/**
 * Awkward rates on purpose: the section subtotals are now summed by Postgres in
 * numeric(18,4) while the document roll-up is still BigInt piastres, and the
 * point of this file is that the two arithmetics agree to the last piastre.
 */
const IMPORT_LINES = [
  ['Gypsum works', '3.3333', '77.7777', '11.1111', 'sqm'],
  ['Gypsum works', '17', '1250.5', '900.25', 'sqm'],
  ['Painting', '0.0001', '0.0001', '0', 'sqm'],
  ['Painting', '999.9999', '333.3333', '111.1111', 'sqm'],
  ['Flooring', '7', '19.999', '12.5', 'pcs'],
] as const;

async function seedThreeSectionBoq(): Promise<{
  ctx: OrgContext;
  projectId: string;
  boqId: string;
}> {
  const { orgId, ownerIds } = await seedOrg({ owners: 1 });
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
  const boqId = (
    (await createBoqCore(ctx, {
      projectId: project.id,
      titleEn: 'Bill of Quantities',
    })) as { data?: string }
  ).data!;

  const res = await commitImportCore(ctx, {
    boqId,
    lines: IMPORT_LINES.map(([section, qty, unitPrice, unitCost, unit], i) => ({
      itemCode: `1.${i + 1}`,
      section,
      description: `${section} item ${i + 1}`,
      unit,
      qty,
      unitPrice,
      unitCost,
      costItemCode: null,
      provisional: false,
    })),
  });
  expect(res.ok).toBe(true);
  return { ctx, projectId: project.id, boqId };
}

interface PersistedLine {
  section_id: string;
  line_cost: string;
  line_total: string;
  line_margin: string;
}

/** The lines exactly as the database now holds them, grouped by section. */
async function linesBySection(
  boqId: string,
): Promise<Map<string, PersistedLine[]>> {
  const rows = await raw.query<PersistedLine>(
    `select section_id, line_cost, line_total, line_margin
       from public.boq_lines where boq_id = '${boqId}'`,
  );
  const grouped = new Map<string, PersistedLine[]>();
  for (const row of rows) {
    const existing = grouped.get(row.section_id);
    if (existing) existing.push(row);
    else grouped.set(row.section_id, [row]);
  }
  return grouped;
}

async function persistedSections(boqId: string) {
  return raw.query<{ id: string; section_subtotal: string }>(
    `select id, section_subtotal from public.boq_sections
      where boq_id = '${boqId}' order by sort_order`,
  );
}

async function persistedDocument(boqId: string) {
  const [row] = await raw.query<Record<string, string>>(
    `select subtotal, discount_amount, total, total_cost, total_margin
       from public.boqs where id = '${boqId}'`,
  );
  return row;
}

describe('the set-based total recompute', () => {
  it('writes the same section subtotals the BigInt engine computes', async () => {
    const { boqId } = await seedThreeSectionBoq();
    const grouped = await linesBySection(boqId);
    const sections = await persistedSections(boqId);
    expect(sections).toHaveLength(3);

    for (const section of sections) {
      const expected = computeSection(
        (grouped.get(section.id) ?? []).map((l) => ({
          lineCost: l.line_cost,
          lineTotal: l.line_total,
          lineMargin: l.line_margin,
        })),
      );
      // Identical to the last piastre AND in the same scale-4 shape.
      expect(section.section_subtotal).toBe(expected.sectionSubtotal);
      expect(parseMoney4(section.section_subtotal)).toBe(
        parseMoney4(expected.sectionSubtotal),
      );
    }
  });

  it('rolls those subtotals up to the document the pure engine would', async () => {
    const { boqId } = await seedThreeSectionBoq();
    const grouped = await linesBySection(boqId);
    const sections = await persistedSections(boqId);

    const expected = computeBoqTotals(
      sections.map((section) =>
        computeSection(
          (grouped.get(section.id) ?? []).map((l) => ({
            lineCost: l.line_cost,
            lineTotal: l.line_total,
            lineMargin: l.line_margin,
          })),
        ),
      ),
      { discountPct: '0' },
    );

    const doc = await persistedDocument(boqId);
    expect(doc.subtotal).toBe(expected.subtotal);
    expect(doc.discount_amount).toBe(expected.discountAmount);
    expect(doc.total).toBe(expected.total);
    expect(doc.total_cost).toBe(expected.totalCost);
    expect(doc.total_margin).toBe(expected.totalMargin);
  });

  it('zeroes a section that has lost every line rather than leaving it stale', async () => {
    const { ctx, projectId, boqId } = await seedThreeSectionBoq();
    const boq = await getProjectBoq(ctx, projectId, { showCost: true });
    const flooring = boq!.sections.find((s) => s.title === 'Flooring')!;
    const subtotalBefore = (await persistedSections(boqId)).find(
      (s) => s.id === flooring.id,
    )!.section_subtotal;
    expect(parseMoney4(subtotalBefore)).toBeGreaterThan(0n);

    expect((await deleteBoqLineCore(ctx, { lineId: flooring.lines[0].id })).ok).toBe(
      true,
    );

    const emptied = (await persistedSections(boqId)).find(
      (s) => s.id === flooring.id,
    )!;
    // The emptied section is summed by a LEFT JOIN, so it reads 0, not its old
    // subtotal — and the document total drops by exactly that much.
    expect(emptied.section_subtotal).toBe('0.0000');
    const doc = await persistedDocument(boqId);
    const [gypsum, painting] = (await persistedSections(boqId)).filter(
      (s) => s.id !== flooring.id,
    );
    expect(parseMoney4(doc.total)).toBe(
      parseMoney4(gypsum.section_subtotal) +
        parseMoney4(painting.section_subtotal),
    );
  });
});
