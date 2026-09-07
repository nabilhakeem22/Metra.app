// PURE BOQ cores — no next/*, no cookies. Take an OrgContext + input; the
// 'use server' wrappers in ./actions do the session work and delegate.
import {
  boqLines,
  boqSections,
  boqs,
  costItems,
  projects,
  type BoqLine,
} from '@metra/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { fail, mutateInOrg } from '@/lib/actions/mutate';
import { err, type ActionResult } from '@/lib/actions/result';
import { allocateNumber } from '@/lib/db/allocate-number';
import type { OrgContext } from '@/lib/db/context';
import { computeLine, computeSection } from '@/lib/aggregates/proposal-totals';
import { computeBoqTotals } from './totals';
import type { ImportedLine } from './import/map';
import { bilingualFor } from './bilingual';

/** Hard cap, mirroring the proposal builder's. A spreadsheet can hold anything. */
export const MAX_BOQ_LINES = 2000;

export interface CreateBoqInput {
  projectId: string;
  titleAr?: string | null;
  titleEn?: string | null;
}

/**
 * Create an empty draft BOQ for a project.
 *
 * The client is taken FROM THE PROJECT rather than passed in: a BOQ priced for
 * one client against another client's project is not a state the UI should be
 * able to reach, and reading it here means there is no input to validate.
 */
export async function createBoqCore(
  ctx: OrgContext,
  input: CreateBoqInput,
): Promise<ActionResult & { data?: string }> {
  const titleAr = input.titleAr?.trim() || null;
  const titleEn = input.titleEn?.trim() || null;
  if (!titleAr && !titleEn) return err('name_required');

  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'create' },
    async (tx) => {
      const [project] = await tx
        .select({ id: projects.id, clientId: projects.clientId })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
      if (!project) fail('boq_not_found');

      const number = await allocateNumber(tx, ctx.orgId, 'boq', 'boqs', 'number');

      const [row] = await tx
        .insert(boqs)
        .values({
          orgId: ctx.orgId,
          number,
          titleAr,
          titleEn,
          projectId: project.id,
          clientId: project.clientId,
        })
        .returning({ id: boqs.id });
      return row?.id;
    },
  );
}

/** Group imported lines by their section label, preserving first-seen order. */
function groupBySection(lines: ImportedLine[]): Map<string, ImportedLine[]> {
  const groups = new Map<string, ImportedLine[]>();
  for (const line of lines) {
    const existing = groups.get(line.section);
    if (existing) existing.push(line);
    else groups.set(line.section, [line]);
  }
  return groups;
}

export interface CommitImportInput {
  boqId: string;
  lines: ImportedLine[];
  /** The uploaded sheet, kept for provenance. */
  sourceFileId?: string | null;
  /** Replace everything already in the BOQ rather than appending. */
  replace?: boolean;
}

/**
 * Write imported lines into a draft BOQ, creating sections as needed and
 * recomputing every total in the same transaction.
 *
 * Totals are SERVER-WRITTEN from the line values, never trusted from the client:
 * the preview computes the same figures with the same functions, so if the two
 * ever disagreed the persisted document would still be the correct one.
 */
export async function commitImportCore(
  ctx: OrgContext,
  input: CommitImportInput,
): Promise<ActionResult & { data?: number }> {
  if (input.lines.length === 0) return err('invalid');
  if (input.lines.length > MAX_BOQ_LINES) return err('too_many_lines');

  return mutateInOrg(
    ctx,
    { capability: 'boq_build', action: 'update' },
    async (tx) => {
      const [boq] = await tx
        .select({ id: boqs.id, status: boqs.status, discountPct: boqs.discountPct })
        .from(boqs)
        .where(eq(boqs.id, input.boqId))
        .limit(1);
      if (!boq) fail('boq_not_found');
      // An issued BOQ is frozen; a revision supersedes it rather than editing it.
      if (boq.status !== 'draft') fail('boq_not_draft');

      if (input.replace) {
        // Lines cascade from sections, so removing sections is enough.
        await tx.delete(boqSections).where(eq(boqSections.boqId, input.boqId));
      }

      const [{ maxSort = -1 } = { maxSort: -1 }] = await tx
        .select({
          maxSort: sql<number>`coalesce(max(${boqSections.sortOrder}), -1)::int`,
        })
        .from(boqSections)
        .where(eq(boqSections.boqId, input.boqId));

      // Resolve price-book codes in ONE query, not one per line. A code that
      // matches gives the line a real cost basis — which is the difference
      // between a BOQ that can report margin later and one that can only count
      // quantities. A code that matches nothing is not an error: the line simply
      // keeps whatever cost the sheet carried.
      const codes = [
        ...new Set(
          input.lines
            .map((l) => l.costItemCode)
            .filter((c): c is string => Boolean(c)),
        ),
      ];
      const priceBook = new Map<
        string,
        { id: string; defaultUnitCost: string }
      >();
      if (codes.length > 0) {
        const found = await tx
          .select({
            id: costItems.id,
            code: costItems.code,
            defaultUnitCost: costItems.defaultUnitCost,
          })
          .from(costItems)
          .where(inArray(costItems.code, codes));
        for (const item of found) {
          priceBook.set(item.code, {
            id: item.id,
            defaultUnitCost: item.defaultUnitCost,
          });
        }
      }

      let sortOrder = maxSort;
      const groups = groupBySection(input.lines);
      const pendingLines: (typeof boqLines.$inferInsert)[] = [];

      for (const [title, groupLines] of groups) {
        sortOrder += 1;
        const [section] = await tx
          .insert(boqSections)
          .values({
            orgId: ctx.orgId,
            boqId: input.boqId,
            titleAr: bilingualFor(title).descriptionAr,
            titleEn: bilingualFor(title).descriptionEn,
            sortOrder,
          })
          .returning({ id: boqSections.id });
        if (!section) fail('invalid');

        groupLines.forEach((line, i) => {
          const matched = line.costItemCode
            ? priceBook.get(line.costItemCode)
            : undefined;
          // The sheet wins when it carries a cost: a studio that overrode the
          // catalogue rate for this project meant it. The price book only fills
          // the gap.
          const unitCost =
            line.unitCost !== '0' ? line.unitCost : (matched?.defaultUnitCost ?? '0');

          const totals = computeLine({
            qty: line.qty,
            unitPrice: line.unitPrice,
            unitCost,
            discountPct: '0',
          });
          pendingLines.push({
            orgId: ctx.orgId,
            boqId: input.boqId,
            sectionId: section.id,
            costItemId: matched?.id ?? null,
            itemCode: line.itemCode,
            ...bilingualFor(line.description),
            qty: line.qty,
            unit: line.unit as (typeof boqLines.$inferInsert)['unit'],
            unitPrice: line.unitPrice,
            unitCost,
            provisional: line.provisional,
            sortOrder: i,
            ...totals,
          });
        });
      }

      // Batched: one insert per import, not one per line.
      if (pendingLines.length > 0) await tx.insert(boqLines).values(pendingLines);

      await recomputeBoqTotals(tx, input.boqId, boq.discountPct);

      if (input.sourceFileId) {
        await tx
          .update(boqs)
          .set({ source: 'imported', sourceFileId: input.sourceFileId })
          .where(eq(boqs.id, input.boqId));
      } else {
        await tx.update(boqs).set({ source: 'imported' }).where(eq(boqs.id, input.boqId));
      }

      return pendingLines.length;
    },
  );
}

type Tx = Parameters<Parameters<typeof mutateInOrg>[2]>[0];

/**
 * Recompute every section subtotal and the document total from the lines as they
 * now stand. Called inside the same transaction as any line change, so a total
 * can never be stale with respect to the lines it sums.
 */
export async function recomputeBoqTotals(
  tx: Tx,
  boqId: string,
  discountPct: string,
): Promise<void> {
  const sections = await tx
    .select({ id: boqSections.id })
    .from(boqSections)
    .where(eq(boqSections.boqId, boqId))
    .orderBy(asc(boqSections.sortOrder));

  const sectionTotals = [];
  for (const section of sections) {
    const lines = await tx
      .select({
        lineCost: boqLines.lineCost,
        lineTotal: boqLines.lineTotal,
        lineMargin: boqLines.lineMargin,
      })
      .from(boqLines)
      .where(
        and(eq(boqLines.boqId, boqId), eq(boqLines.sectionId, section.id)),
      );

    const totals = computeSection(
      lines.map((l: Pick<BoqLine, 'lineCost' | 'lineTotal' | 'lineMargin'>) => ({
        lineCost: l.lineCost,
        lineTotal: l.lineTotal,
        lineMargin: l.lineMargin,
      })),
    );
    sectionTotals.push(totals);

    await tx
      .update(boqSections)
      .set({ sectionSubtotal: totals.sectionSubtotal })
      .where(eq(boqSections.id, section.id));
  }

  const doc = computeBoqTotals(sectionTotals, { discountPct });
  await tx
    .update(boqs)
    .set({
      subtotal: doc.subtotal,
      discountAmount: doc.discountAmount,
      total: doc.total,
      totalCost: doc.totalCost,
      totalMargin: doc.totalMargin,
    })
    .where(eq(boqs.id, boqId));
}
