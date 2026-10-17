import { describe, expect, it } from 'vitest';
import { bulletin, months, page, printedCells, row } from '../testing/fixtures';
import { brief, checkFixture } from '../testing/run';

const withRow = (overrides: Parameters<typeof row>[0]) => bulletin({ pages: [page({ rows: [row(overrides)] })] });

describe('market:check blocking rules', () => {
  it('passes the valid fixture with nothing but the offline new-item flag', () => {
    const outcome = checkFixture(bulletin());
    expect(brief(outcome, { keepNewItems: true })).toEqual(['F4 p2.r1']);
    expect(outcome.staged.blocking).toEqual([]);
    expect(outcome.staged.observations).toHaveLength(7);
  });

  it('B0: the file is for another period, or a source hash differs from the file on disk', () => {
    expect(brief(checkFixture(bulletin(), { period: '2026-06' }))).toEqual(['B0 page -']);
  });

  it('B1: a value after the bulletin month', () => {
    const slots = months('38200', '38200', '38200', '39850', '39850', '39850', '39850', '39850');
    expect(brief(checkFixture(withRow({ months: slots })))).toContain('B1 p2.r1 m8');
  });

  it('B2: an unsplit merge above 10,000,000 never reaches staged.json (AC 9)', () => {
    const slots = months('1596029811');
    const outcome = checkFixture(withRow({ months: slots, verbatimCells: printedCells(slots) }));
    expect(brief(outcome)).toContain('B2 p2.r1 m1');
    expect(outcome.staged.observations).toEqual([]);
    expect(outcome.staged.items).toEqual([]);
  });

  it('B2: a zero value', () => {
    const slots = months('0.000');
    expect(brief(checkFixture(withRow({ months: slots, verbatimCells: printedCells(slots) })))).toContain('B2 p2.r1 m1');
  });

  it('B3: a unit label the map does not know', () => {
    expect(brief(checkFixture(withRow({ unitLabelAr: 'برميل' })))).toEqual(['B3 p2.r1']);
  });

  it('B4: a sub-category that is not a leaf, and a key outside its sub-category', () => {
    expect(brief(checkFixture(bulletin({ pages: [page({ subCategoryKey: 'raw' })] })))).toContain('B4 page 2');
    expect(brief(checkFixture(withRow({ proposedKey: 'raw.cement.rebar' })))).toEqual(['B4 p2.r1']);
    expect(brief(checkFixture(withRow({ proposedKey: 'raw.steel' })))).toEqual(['B4 p2.r1']);
  });

  it('B5: two rows publishing under one key, and a yearly table naming no row', () => {
    const twin = row({ rowId: 'p2.r2' });
    const file = bulletin({ pages: [page({ rows: [row(), twin], legendLabelsAr: ['a', 'b'] })] });
    expect(brief(checkFixture(file))).toContain('B5 p2.r2');
    const orphan = bulletin({ pages: [page({ yearly: { ...page().yearly!, rowId: 'p2.r9' } })] });
    expect(brief(checkFixture(orphan))).toContain('B5 page 2');
  });

  it('B8: a page neither priced nor skipped, and a page covered twice (AC 21)', () => {
    const gap = bulletin({ skippedPages: [{ pdfPage: 1, printedPage: null, reason: 'cover' }] });
    expect(brief(checkFixture(gap))).toEqual(['B8 page 3']);
    const twice = bulletin({ skippedPages: [...bulletin().skippedPages, { pdfPage: 2, printedPage: null, reason: 'oops' }] });
    expect(brief(checkFixture(twice))).toEqual(['B8 page 2']);
  });

  it('B8: a page present in two part files (AC 21)', () => {
    const first = bulletin({ skippedPages: [{ pdfPage: 1, printedPage: null, reason: 'cover' }] });
    const second = bulletin({ skippedPages: [{ pdfPage: 3, printedPage: null, reason: 'directory' }] });
    expect(brief(checkFixture(null, { parts: [first, second] }))).toContain('B8 page 2');
  });

  it('B0: part files whose headers differ', () => {
    const first = bulletin({ pages: [], skippedPages: [{ pdfPage: 1, printedPage: null, reason: 'cover' }] });
    const second = bulletin({ source: { ...bulletin().source, pdfPageCount: 4 } });
    expect(brief(checkFixture(null, { parts: [first, second] }))).toEqual(['B0 page -']);
  });

  it('B9: an inferred row with an empty month, resolved by a correction or a skip', () => {
    const slots = months('38200', '38200', '38200', '39850', '39850', '39850', null);
    const file = withRow({ months: slots, verbatimCells: printedCells(slots), confidence: 'inferred', rule: 'R7' });
    expect(brief(checkFixture(file))).toEqual(['B9 p2.r1 m7', 'F10 p2.r1']);
    const corrected = checkFixture(file, { corrections: [{ rowId: 'p2.r1', month: 7, value: '39850', reason: 'PDF page 6' }] });
    expect(brief(corrected)).toEqual(['F10 p2.r1']);
    const skipped = checkFixture(file, { mapping: { 'p2.r1': { action: 'skip', reason: 'not needed' } } });
    expect(brief(skipped)).toEqual([]);
  });

  it('B9: an unreadable row needs every month up to the bulletin month confirmed', () => {
    const file = withRow({ confidence: 'unreadable', rule: 'R9' });
    expect(brief(checkFixture(file))).toEqual(['B9 p2.r1']);
    const all = [1, 2, 3, 4, 5, 6, 7].map((month) => ({ rowId: 'p2.r1', month, value: month < 4 ? '38200' : '39850', reason: 'PDF' }));
    expect(brief(checkFixture(file, { corrections: all }))).toEqual([]);
  });

  it('B10: a non-read row without a rule, or with a rule outside R1..R10 (AC 22)', () => {
    expect(brief(checkFixture(withRow({ confidence: 'inferred', rule: null })))).toEqual(['B10 p2.r1', 'F10 p2.r1']);
    expect(brief(checkFixture(withRow({ confidence: 'inferred', rule: 'R11' })))).toEqual(['B10 p2.r1', 'F10 p2.r1']);
    expect(brief(checkFixture(withRow({ confidence: 'inferred', rule: 'R6, R1' })))).toEqual(['F10 p2.r1']);
  });

  it('B12: a value that is not what its printed cell says; a correction is exempt', () => {
    const cells = printedCells(row().months);
    cells[3] = '٣٩٥٨٠';
    const file = withRow({ verbatimCells: cells });
    expect(brief(checkFixture(file))).toEqual(['B12 p2.r1 m4']);
    const corrected = checkFixture(file, { corrections: [{ rowId: 'p2.r1', month: 4, value: '39850', reason: 'PDF' }] });
    expect(brief(corrected)).toEqual([]);
  });

  it('B0: mapping and corrections that name no row, or a malformed correction', () => {
    expect(brief(checkFixture(bulletin(), { mapping: { 'p9.r1': { action: 'skip', reason: 'x' } } }))).toEqual(['B0 p9.r1']);
    expect(brief(checkFixture(bulletin(), { corrections: [{ rowId: 'p2.r1', month: 13, value: '1', reason: 'x' }] }))).toEqual(['B0 page -']);
    expect(brief(checkFixture(bulletin(), { corrections: [{ rowId: 'p2.r1', month: 1, value: '٣٨٢٠٠', reason: 'x' }] }))).toEqual(['B2 page -']);
  });
});
