import { describe, expect, it } from 'vitest';
import { admixturesPage, exampleFile, glassPage, steelSectionsPage } from '../testing/examples';
import { brief, checkFixture } from '../testing/run';

describe('the worked examples E3, E4 and E5', () => {
  it('read from the MD: exactly the expected findings', () => {
    const file = exampleFile([steelSectionsPage(), admixturesPage(), glassPage()], 'md', 65);
    const outcome = checkFixture(file);
    expect(brief(outcome)).toEqual([
      // E3: 6 values for 7 months on every admixtures row; July stays on the confirm list.
      'B9 p6.r1 m7', 'B9 p6.r2 m7', 'B9 p6.r3 m7', 'B9 p6.r4 m7', 'B9 p6.r5 m7', 'B9 p6.r6 m7',
      // The March step on page 2 (15.2% and 22.2%) and the March spike on page 65 are real.
      'F1 p2.r1 m3', 'F1 p2.r2 m3',
      'F1 p65.r1 m3', 'F1 p65.r2 m3', 'F1 p65.r3 m3', 'F1 p65.r4 m3', 'F1 p65.r5 m3', 'F1 p65.r6 m3',
      // E5: July 51000 against 38500 is 32.5%, the yearly table prints 40.
      'F8 p2.r2 m7',
      'F10 p6.r1', 'F10 p6.r2', 'F10 p6.r3', 'F10 p6.r4', 'F10 p6.r5', 'F10 p6.r6',
      // E4: the merged reflective rows, split by R6.
      'F10 p65.r5', 'F10 p65.r6',
    ]);
    expect(outcome.findings.filter((item) => item.code === 'F4')).toHaveLength(16);
    const e5 = outcome.findings.find((item) => item.code === 'F8');
    expect(e5?.message).toContain('38500 -> 51000 is 32.5% but the yearly table prints 40%');
    expect(outcome.staged.observations).toEqual([]);
  });

  it('E5 is listed, never fixed: the July value stays 51000', () => {
    const file = exampleFile([steelSectionsPage()], 'md', 2);
    const outcome = checkFixture(file);
    expect(brief(outcome)).toEqual(['F1 p2.r1 m3', 'F1 p2.r2 m3', 'F8 p2.r2 m7']);
    const july = outcome.staged.observations.find((item) => item.itemKey === 'raw.steel.medium_beams' && item.month === '2026-07');
    expect(july).toEqual({ itemKey: 'raw.steel.medium_beams', month: '2026-07', status: 'priced', price: '51000', pdfPage: null, printedPage: 2 });
  });

  it('E3 (AC 19): B9 names the row and printed page 6; a confirmed empty July clears it', () => {
    const page = admixturesPage();
    const single = { ...page, rows: [page.rows[0]], legendLabelsAr: [page.legendLabelsAr[0]] };
    const file = exampleFile([single], 'md', 6);
    const blocked = checkFixture(file);
    expect(blocked.findings.filter((item) => item.code === 'B9')).toEqual([
      expect.objectContaining({ rowId: 'p6.r1', page: 6, month: 7 }),
    ]);
    const confirmed = checkFixture(file, { corrections: [{ rowId: 'p6.r1', month: 7, value: null, reason: 'PDF page 11: July is empty' }] });
    expect(confirmed.staged.blocking).toEqual([]);
    expect(confirmed.staged.observations.filter((item) => item.itemKey === 'raw.concrete_admixtures.workability')).toHaveLength(6);
  });

  it('read from the PDF: the same pages need no inference, and the true March values show', () => {
    const file = exampleFile([steelSectionsPage('pdf'), admixturesPage('pdf'), glassPage('pdf')], 'pdf', 87);
    const outcome = checkFixture(file);
    expect(outcome.findings.filter((item) => item.code.startsWith('B') || item.code === 'F10')).toEqual([]);
    const march = (key: string) => outcome.staged.observations.find((item) => item.itemKey === key && item.month === '2026-03')?.price;
    expect(march('finishing.glass.green_reflective_6mm')).toBe('969');
    expect(march('finishing.glass.blue_reflective_6mm')).toBe('1026');
  });
});
