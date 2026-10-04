import 'server-only';
import { boqLines, boqSections, boqs, type MetraDb } from '@metra/db';
import { asc, eq } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';
import { formatDocNumber } from '@/lib/format/doc-number';
import type { BoqDetail, BoqLineRow } from './types';

const pick = (ar: string | null, en: string | null) => ar ?? en ?? '';

/** The section-keyed line rows, cost fields only when `showCost`. */
function groupLinesBySection(
  lineRows: Array<typeof boqLines.$inferSelect>,
  showCost: boolean,
): Map<string, BoqLineRow[]> {
  const bySection = new Map<string, BoqLineRow[]>();
  for (const l of lineRows) {
    const row: BoqLineRow = {
      id: l.id,
      itemCode: l.itemCode,
      description: pick(l.descriptionAr, l.descriptionEn),
      unit: l.unit,
      qty: l.qty,
      unitPrice: l.unitPrice,
      discountPct: l.discountPct,
      lineTotal: l.lineTotal,
      provisional: l.provisional,
      ...(showCost
        ? { unitCost: l.unitCost, lineCost: l.lineCost, lineMargin: l.lineMargin }
        : {}),
    };
    const existing = bySection.get(l.sectionId);
    if (existing) existing.push(row);
    else bySection.set(l.sectionId, [row]);
  }
  return bySection;
}

/**
 * One BOQ by id, inside the caller's RLS transaction, or null. Sections and lines
 * come back in one round trip each rather than per-section, so a 2000-line BOQ is
 * three queries.
 *
 * `showCost` gates every cost and margin field at the QUERY, not in the view —
 * a margin-blind role must never receive the numbers in the first place, because
 * anything sent to the client is readable whatever the UI chooses to render.
 */
export async function readBoqDetail(
  tx: MetraDb,
  boqId: string,
  opts: { showCost: boolean },
): Promise<BoqDetail | null> {
  const [boq] = await tx.select().from(boqs).where(eq(boqs.id, boqId)).limit(1);
  if (!boq) return null;

  const sectionRows = await tx
    .select()
    .from(boqSections)
    .where(eq(boqSections.boqId, boq.id))
    .orderBy(asc(boqSections.sortOrder));

  const lineRows = await tx
    .select()
    .from(boqLines)
    .where(eq(boqLines.boqId, boq.id))
    .orderBy(asc(boqLines.sortOrder));

  const bySection = groupLinesBySection(lineRows, opts.showCost);

  return {
    id: boq.id,
    number: boq.number,
    documentNumber: formatDocNumber('BQ', boq.number, new Date(boq.createdAt).getUTCFullYear()),
    version: boq.version,
    title: pick(boq.titleAr, boq.titleEn),
    status: boq.status,
    source: boq.source,
    currency: boq.currency,
    discountPct: boq.discountPct,
    subtotal: boq.subtotal,
    discountAmount: boq.discountAmount,
    total: boq.total,
    lineCount: lineRows.length,
    sections: sectionRows.map((s) => ({
      id: s.id,
      title: pick(s.titleAr, s.titleEn),
      sectionSubtotal: s.sectionSubtotal,
      lines: bySection.get(s.id) ?? [],
    })),
    ...(opts.showCost
      ? { totalCost: boq.totalCost, totalMargin: boq.totalMargin }
      : {}),
  };
}

/** One BOQ by id in the caller's org, or null (absent, or another org's). */
export async function getBoqDetail(
  ctx: OrgContext,
  boqId: string,
  opts: { showCost: boolean },
): Promise<BoqDetail | null> {
  return withOrgContext(ctx, (tx) => readBoqDetail(tx, boqId, opts));
}
