// Stage 3a of the draft save: compare what the save resolved with what the draft
// stores, and plan the fewest writes that make the second equal the first. PURE
// (no DB): the plan is applied by ./draft-save-persist.
//
// Identity. A section the payload names by a stored id keeps that id (the first
// section to claim it; a repeat gets a fresh one). A line keeps a stored id the
// resolver kept for it (./draft-save-resolve: one claim per id), even when it
// moved section. Every other row is new, under a fresh uuid, so an id of another
// proposal's line can only ever create a NEW line here.
//
// Change. A kept row is updated only when one of its WRITTEN columns differs:
// figures compared as the scale-4 string the money engine produces ("12" equals
// the stored "12.0000"), text as-is with absent read as null. The column lists
// are typed `Record<keyof Written*, ...>`, so a column added to what the save
// writes fails the build here until it is compared.
import { randomUUID } from 'node:crypto';
import { formatMoney4, parseMoney4 } from '@/lib/aggregates/proposal-totals';
import type { ResolvedLine, ResolvedSection } from './draft-save-resolve';
import type { StoredDraft, WrittenLine, WrittenSection } from './draft-save-stored';
import type { DraftSaveReceipt } from './types';

export type SectionWrite = WrittenSection & { id: string };
export type LineWrite = WrittenLine & { id: string };

export interface DraftWritePlan {
  sectionInserts: SectionWrite[];
  sectionUpdates: SectionWrite[];
  sectionDeletes: string[];
  lineInserts: LineWrite[];
  lineUpdates: LineWrite[];
  lineDeletes: string[];
  receipt: DraftSaveReceipt['sections'];
}

type ColumnKind = 'money' | 'value';

export const SECTION_COLUMNS: Readonly<Record<keyof WrittenSection, ColumnKind>> = {
  titleAr: 'value',
  titleEn: 'value',
  sortOrder: 'value',
  sectionSubtotal: 'money',
};

export const LINE_COLUMNS: Readonly<Record<keyof WrittenLine, ColumnKind>> = {
  sectionId: 'value',
  costItemId: 'value',
  descriptionAr: 'value',
  descriptionEn: 'value',
  qty: 'money',
  unit: 'value',
  unitCost: 'money',
  unitPrice: 'money',
  discountPct: 'money',
  lineCost: 'money',
  lineTotal: 'money',
  lineMargin: 'money',
  sortOrder: 'value',
};

/** One row's written columns as one comparable string. */
function canonicalRow<Row>(row: Row, columns: Readonly<Record<string, ColumnKind>>): string {
  const values = Object.entries(columns).map(([column, kind]) => {
    const value = (row as Record<string, unknown>)[column] ?? null;
    if (value === null) return null;
    return kind === 'money' ? formatMoney4(parseMoney4(String(value))) : String(value);
  });
  return JSON.stringify(values);
}

function isChanged<Row>(
  stored: Row | undefined,
  next: Row,
  columns: Readonly<Record<string, ColumnKind>>,
): boolean {
  return stored === undefined || canonicalRow(stored, columns) !== canonicalRow(next, columns);
}

/** The ids of `stored` rows no write kept. */
function unkept(stored: Map<string, unknown>, kept: Set<string>): string[] {
  return [...stored.keys()].filter((id) => !kept.has(id));
}

/** Rows already claimed by an earlier section or line of this payload. */
interface Claims {
  sections: Set<string>;
  lines: Set<string>;
}

/** The kept id when `id` is stored and not yet claimed, else null. */
function claim(id: string | undefined, stored: Map<string, unknown>, claimed: Set<string>): string | null {
  if (id === undefined || !stored.has(id) || claimed.has(id)) return null;
  claimed.add(id);
  return id;
}

function planSection(section: ResolvedSection, stored: StoredDraft, claims: Claims, plan: DraftWritePlan): string {
  const keptId = claim(section.id, stored.sections, claims.sections);
  const next: SectionWrite = {
    id: keptId ?? randomUUID(),
    titleAr: section.titleAr,
    titleEn: section.titleEn,
    sortOrder: section.sortOrder,
    sectionSubtotal: section.subtotal,
  };
  if (keptId === null) plan.sectionInserts.push(next);
  else if (isChanged(stored.sections.get(keptId), next, SECTION_COLUMNS)) plan.sectionUpdates.push(next);
  return next.id;
}

function planLine(
  line: ResolvedLine,
  sectionId: string,
  stored: StoredDraft,
  claims: Claims,
  plan: DraftWritePlan,
): string {
  const { id: resolvedId, ...written } = line;
  const keptId = claim(resolvedId, stored.lines, claims.lines);
  const next: LineWrite = { ...written, id: keptId ?? randomUUID(), sectionId };
  if (keptId === null) plan.lineInserts.push(next);
  else if (isChanged(stored.lines.get(keptId), next, LINE_COLUMNS)) plan.lineUpdates.push(next);
  return next.id;
}

/** The writes that make the stored draft equal `resolved`, and the receipt in sent order. */
export function planDraftWrite(resolved: ResolvedSection[], stored: StoredDraft): DraftWritePlan {
  const plan: DraftWritePlan = {
    sectionInserts: [],
    sectionUpdates: [],
    sectionDeletes: [],
    lineInserts: [],
    lineUpdates: [],
    lineDeletes: [],
    receipt: [],
  };
  const claims: Claims = { sections: new Set(), lines: new Set() };
  for (const section of resolved) {
    const sectionId = planSection(section, stored, claims, plan);
    const lineIds = section.lines.map((line) => planLine(line, sectionId, stored, claims, plan));
    plan.receipt.push({ id: sectionId, lineIds });
  }
  plan.sectionDeletes = unkept(stored.sections, claims.sections);
  plan.lineDeletes = unkept(stored.lines, claims.lines);
  return plan;
}
