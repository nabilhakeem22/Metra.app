import { describe, expect, it } from 'vitest';
import { planDraftWrite } from './draft-save-diff';
import type { ResolvedLine, ResolvedSection } from './draft-save-resolve';
import type { StoredDraft, StoredLineRow, StoredSectionRow } from './draft-save-stored';

const SECTION_A = '00000000-0000-4000-8000-00000000000a';
const SECTION_B = '00000000-0000-4000-8000-00000000000b';
const lineId = (n: number) => `00000000-0000-4000-8000-1000000000${String(n).padStart(2, '0')}`;

/** A resolved line as the resolver hands it over (figures as typed, totals scale-4). */
function resolvedLine(n: number, overrides: Partial<ResolvedLine> = {}): ResolvedLine {
  return {
    id: lineId(n),
    costItemId: null,
    descriptionAr: null,
    descriptionEn: `Line ${n}`,
    qty: '2',
    unit: 'sqm',
    unitCost: '60',
    unitPrice: '100',
    discountPct: '0',
    lineCost: '120.0000',
    lineTotal: '200.0000',
    lineMargin: '80.0000',
    sortOrder: n,
    ...overrides,
  };
}

/** The same line as the database answers it (numeric(18,4) strings). */
function storedLine(n: number, sectionId: string, sortOrder = n): StoredLineRow {
  return {
    id: lineId(n),
    sectionId,
    costItemId: null,
    descriptionAr: null,
    descriptionEn: `Line ${n}`,
    qty: '2.0000',
    unit: 'sqm',
    unitCost: '60.0000',
    unitPrice: '100.0000',
    discountPct: '0.0000',
    lineCost: '120.0000',
    lineTotal: '200.0000',
    lineMargin: '80.0000',
    sortOrder,
  };
}

function section(id: string | undefined, sortOrder: number, lines: ResolvedLine[], subtotal: string): ResolvedSection {
  return { id, titleAr: null, titleEn: `Section ${sortOrder}`, sortOrder, subtotal, lines };
}

function storedSection(id: string, sortOrder: number, subtotal: string): StoredSectionRow {
  return { id, titleAr: null, titleEn: `Section ${sortOrder}`, sortOrder, sectionSubtotal: subtotal };
}

/** Section A holds lines 0 and 1, section B holds line 2. */
function storedDraft(): StoredDraft {
  const sections = [storedSection(SECTION_A, 0, '400.0000'), storedSection(SECTION_B, 1, '200.0000')];
  const lines = [storedLine(0, SECTION_A, 0), storedLine(1, SECTION_A, 1), storedLine(2, SECTION_B, 0)];
  return {
    sections: new Map(sections.map((row) => [row.id, row])),
    lines: new Map(lines.map((row) => [row.id, row])),
  };
}

function unchangedPayload(): ResolvedSection[] {
  return [
    section(SECTION_A, 0, [resolvedLine(0, { sortOrder: 0 }), resolvedLine(1, { sortOrder: 1 })], '400.0000'),
    section(SECTION_B, 1, [resolvedLine(2, { sortOrder: 0 })], '200.0000'),
  ];
}

/** How many rows each kind of write touches. */
const writes = ({ receipt: _receipt, ...plan }: ReturnType<typeof planDraftWrite>) =>
  Object.fromEntries(Object.entries(plan).map(([kind, rows]) => [kind, rows.length]));
const NONE = { sectionInserts: 0, sectionUpdates: 0, sectionDeletes: 0, lineInserts: 0, lineUpdates: 0, lineDeletes: 0 };

describe('planDraftWrite', () => {
  it('an unchanged document plans no write, figures compared at scale 4', () => {
    const plan = planDraftWrite(unchangedPayload(), storedDraft());
    expect(writes(plan)).toEqual(NONE);
    expect(plan.receipt).toEqual([
      { id: SECTION_A, lineIds: [lineId(0), lineId(1)] },
      { id: SECTION_B, lineIds: [lineId(2)] },
    ]);
  });

  it('one edited line is one line update, carrying every written column', () => {
    const payload = unchangedPayload();
    payload[1].lines[0] = resolvedLine(2, { sortOrder: 0, descriptionEn: 'Renamed' });
    const plan = planDraftWrite(payload, storedDraft());
    expect(writes(plan)).toEqual({ ...NONE, lineUpdates: 1 });
    expect(plan.lineUpdates[0]).toEqual({ ...storedLine(2, SECTION_B, 0), ...resolvedLine(2, { sortOrder: 0, descriptionEn: 'Renamed' }), sectionId: SECTION_B });
  });

  it('an edited figure updates the line and its section total, nothing else', () => {
    const payload = unchangedPayload();
    payload[1] = section(SECTION_B, 1, [resolvedLine(2, { sortOrder: 0, qty: '3', lineTotal: '300.0000', lineCost: '180.0000', lineMargin: '120.0000' })], '300.0000');
    expect(writes(planDraftWrite(payload, storedDraft()))).toEqual({ ...NONE, lineUpdates: 1, sectionUpdates: 1 });
  });

  it('a line moved to another section keeps its id: one line update naming the new section', () => {
    const payload = [
      section(SECTION_A, 0, [resolvedLine(0, { sortOrder: 0 })], '400.0000'),
      section(SECTION_B, 1, [resolvedLine(2, { sortOrder: 0 }), resolvedLine(1, { sortOrder: 1 })], '200.0000'),
    ];
    const plan = planDraftWrite(payload, storedDraft());
    expect(plan.lineUpdates).toHaveLength(1);
    expect(plan.lineUpdates[0]).toMatchObject({ id: lineId(1), sectionId: SECTION_B, sortOrder: 1 });
    expect(plan.lineInserts).toHaveLength(0);
    expect(plan.lineDeletes).toHaveLength(0);
  });

  it('an id the draft does not store (another proposal) is a new line under a fresh id', () => {
    const foreign = '00000000-0000-4000-8000-99999999999f';
    const payload = unchangedPayload();
    payload[1].lines.push(resolvedLine(9, { id: foreign, sortOrder: 1 }));
    const plan = planDraftWrite(payload, storedDraft());
    expect(plan.lineInserts).toHaveLength(1);
    expect(plan.lineInserts[0].id).not.toBe(foreign);
    expect(plan.lineInserts[0].sectionId).toBe(SECTION_B);
    expect(plan.receipt[1].lineIds[1]).toBe(plan.lineInserts[0].id);
  });

  it('an empty document deletes every stored section and line', () => {
    const plan = planDraftWrite([], storedDraft());
    expect(writes(plan)).toEqual({ ...NONE, sectionDeletes: 2, lineDeletes: 3 });
    expect(plan.receipt).toEqual([]);
  });

  it('a section id named twice is kept by the first; the repeat is a new section', () => {
    const payload = [...unchangedPayload(), section(SECTION_A, 2, [], '0.0000')];
    const plan = planDraftWrite(payload, storedDraft());
    expect(plan.sectionInserts).toHaveLength(1);
    expect(plan.sectionInserts[0].id).not.toBe(SECTION_A);
    expect(plan.receipt.map((entry) => entry.id).slice(0, 2)).toEqual([SECTION_A, SECTION_B]);
  });

  it('a section sent without an id is new, and its old row and lines go', () => {
    const payload = [section(undefined, 0, [resolvedLine(0, { sortOrder: 0 }), resolvedLine(1, { sortOrder: 1 })], '400.0000'), unchangedPayload()[1]];
    const plan = planDraftWrite(payload, storedDraft());
    expect(writes(plan)).toEqual({ ...NONE, sectionInserts: 1, sectionDeletes: 1, lineUpdates: 2 });
    expect(plan.sectionDeletes).toEqual([SECTION_A]);
    expect(plan.lineUpdates.every((line) => line.sectionId === plan.sectionInserts[0].id)).toBe(true);
  });
});
