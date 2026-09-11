import 'server-only';
import { boqLines, boqSections, boqs } from '@metra/db';
import { asc, eq, sql } from 'drizzle-orm';
import type { OrgContext } from '@/lib/db/context';
import { withOrgContext } from '@/lib/db/context';

export interface BoqLineRow {
  id: string;
  itemCode: string | null;
  description: string;
  unit: string;
  qty: string;
  unitPrice: string;
  /** Per-line discount. Not margin data — it is a reduction off a price the
   *  client already sees, and the sheet needs it to preview a line total that
   *  matches what the server will store. */
  discountPct: string;
  lineTotal: string;
  provisional: boolean;
  /** Margin-gated: present only when the caller may see cost. */
  unitCost?: string;
  lineCost?: string;
  lineMargin?: string;
}

export interface BoqSectionRow {
  id: string;
  title: string;
  sectionSubtotal: string;
  lines: BoqLineRow[];
}

export interface BoqDetail {
  id: string;
  number: number;
  title: string;
  status: string;
  source: string;
  currency: string;
  discountPct: string;
  subtotal: string;
  discountAmount: string;
  total: string;
  lineCount: number;
  sections: BoqSectionRow[];
  totalCost?: string;
  totalMargin?: string;
}

const pick = (ar: string | null, en: string | null) => ar ?? en ?? '';

/**
 * The project's current BOQ, or null. Sections and lines come back in one round
 * trip each rather than per-section, so a 2000-line BOQ is two queries.
 *
 * `showCost` gates every cost and margin field at the QUERY, not in the view —
 * a margin-blind role must never receive the numbers in the first place, because
 * anything sent to the client is readable whatever the UI chooses to render.
 */
export async function getProjectBoq(
  ctx: OrgContext,
  projectId: string,
  opts: { showCost: boolean },
): Promise<BoqDetail | null> {
  return withOrgContext(ctx, async (db) => {
    const [boq] = await db
      .select()
      .from(boqs)
      .where(eq(boqs.projectId, projectId))
      .orderBy(asc(boqs.createdAt))
      .limit(1);
    if (!boq) return null;

    const sectionRows = await db
      .select()
      .from(boqSections)
      .where(eq(boqSections.boqId, boq.id))
      .orderBy(asc(boqSections.sortOrder));

    const lineRows = await db
      .select()
      .from(boqLines)
      .where(eq(boqLines.boqId, boq.id))
      .orderBy(asc(boqLines.sortOrder));

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
        ...(opts.showCost
          ? { unitCost: l.unitCost, lineCost: l.lineCost, lineMargin: l.lineMargin }
          : {}),
      };
      const existing = bySection.get(l.sectionId);
      if (existing) existing.push(row);
      else bySection.set(l.sectionId, [row]);
    }

    return {
      id: boq.id,
      number: boq.number,
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
  });
}

/**
 * Just enough about a project's BOQ for the cockpit to decide what to offer.
 *
 * Deliberately NOT `getProjectBoq`: the command card needs a status and a count,
 * and pulling every section and line of a 2000-line document to render one
 * button would be a real cost on a page that already does a lot.
 */
export async function getProjectBoqSummary(
  ctx: OrgContext,
  projectId: string,
): Promise<{ id: string; status: string; lineCount: number } | null> {
  return withOrgContext(ctx, async (db) => {
    const [boq] = await db
      .select({ id: boqs.id, status: boqs.status })
      .from(boqs)
      .where(eq(boqs.projectId, projectId))
      .orderBy(asc(boqs.createdAt))
      .limit(1);
    if (!boq) return null;

    const [counted] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(boqLines)
      .where(eq(boqLines.boqId, boq.id));

    return { id: boq.id, status: boq.status, lineCount: counted?.n ?? 0 };
  });
}
