import { describe, expect, it } from 'vitest';
import { guardBulletinFile } from './guard';
import { asJson, bulletin, months, page, row } from './testing/fixtures';

function refusal(value: unknown) {
  const result = guardBulletinFile(value);
  if (result.ok) throw new Error('expected the guard to refuse');
  return result.findings;
}

describe('guardBulletinFile', () => {
  it('accepts the valid fixture and hands it back typed', () => {
    const result = guardBulletinFile(asJson(bulletin()));
    expect(result.ok).toBe(true);
  });

  it('refuses a missing key, naming it', () => {
    const file = asJson(bulletin());
    delete file.producedBy;
    const findings = refusal(file);
    expect(findings).toEqual([expect.objectContaining({ code: 'B0', message: '$: missing key "producedBy"' })]);
  });

  it('refuses an unknown key, at any depth', () => {
    const file = asJson(bulletin());
    file.pages[0].rows[0].brand = 'Ezz';
    const findings = refusal(file);
    expect(findings).toEqual([
      expect.objectContaining({ code: 'B0', rowId: null, page: 2, message: expect.stringContaining('unknown key "brand"') }),
    ]);
  });

  it('refuses 11 month slots with B1', () => {
    const file = asJson(bulletin());
    file.pages[0].rows[0].months.pop();
    const findings = refusal(file);
    expect(findings).toEqual([
      expect.objectContaining({ code: 'B1', rowId: 'p2.r1', page: 2, message: expect.stringContaining('found 11') }),
    ]);
  });

  it('refuses an Arabic-Indic digit in a value with B2, and names the month', () => {
    const file = asJson(bulletin({ pages: [page({ rows: [row({ months: months('٣٨٢٠٠') })] })] }));
    const findings = refusal(file);
    expect(findings).toEqual([
      expect.objectContaining({ code: 'B2', month: 1, message: expect.stringContaining('Arabic-Indic digit') }),
    ]);
  });

  it('refuses a grouped number with B2', () => {
    const file = asJson(bulletin({ pages: [page({ rows: [row({ months: months('38,200') })] })] }));
    expect(refusal(file)).toEqual([
      expect.objectContaining({ code: 'B2', message: expect.stringContaining('separator in a value') }),
    ]);
  });

  it.each([['-5'], ['1.23456'], [''], ['12a']])('refuses the value %j', (value) => {
    const file = asJson(bulletin({ pages: [page({ rows: [row({ months: months(value) })] })] }));
    expect(refusal(file).map((item) => item.code)).toEqual(['B2']);
  });

  it('refuses a number where a decimal string belongs', () => {
    const file = asJson(bulletin());
    file.pages[0].rows[0].months[0] = 38200;
    expect(refusal(file).map((item) => item.code)).toEqual(['B2']);
  });

  it('requires verbatim cells when the values were read from the PDF', () => {
    const file = asJson(bulletin({ pages: [page({ rows: [row({ verbatimCells: null })] })] }));
    expect(refusal(file)).toEqual([expect.objectContaining({ code: 'B1', message: expect.stringContaining('verbatimCells') })]);
  });

  it('requires the MD fragment and the MD hash when the values were read from the MD', () => {
    const file = asJson(bulletin({ readFrom: 'md' }));
    const messages = refusal(file).map((item) => item.message);
    expect(messages).toContain('$.source: readFrom "md" needs mdFileName and mdSha256');
    expect(messages.some((message) => message.includes('mdTokens: expected a string'))).toBe(true);
  });

  it('requires the PDF page on every page read from the PDF, and checks the row id against it', () => {
    const file = asJson(bulletin({ pages: [page({ pdfPage: null })] }));
    const messages = refusal(file).map((item) => item.message);
    expect(messages.some((message) => message.includes('pdfPage: expected a positive integer'))).toBe(true);
    const wrongRow = asJson(bulletin({ pages: [page({ rows: [row({ rowId: 'p7.r1' })] })] }));
    expect(refusal(wrongRow)).toEqual([expect.objectContaining({ code: 'B0', message: expect.stringContaining('"p2.r<n>"') })]);
  });

  it('refuses a printed percentage that is not "23", "-8" or "2.4"', () => {
    const file = asJson(bulletin());
    file.pages[0].yearly.printedPct[0] = '%23';
    expect(refusal(file).map((item) => item.code)).toEqual(['B2']);
  });

  it('refuses a malformed sha256 and a wrong format id', () => {
    const file = asJson(bulletin());
    file.source.pdfSha256 = 'ABC';
    file.format = 'metra.market-bulletin.v2';
    expect(refusal(file).map((item) => item.code)).toEqual(['B0', 'B0']);
  });

  it('reports every problem, not the first one', () => {
    const file = asJson(bulletin());
    file.period = '2026-13';
    file.pages[0].rows[0].months[1] = '1,5';
    file.pages[0].rows[0].confidence = 'sure';
    expect(refusal(file).map((item) => item.code).sort()).toEqual(['B0', 'B0', 'B2']);
  });

  it('refuses Arabic-Indic digits and em/en dashes in a text studios see', () => {
    const file = asJson(bulletin({ pages: [page({ rows: [row({ specAr: '٦ مم', labelAr: 'زجاج \u2013 شفاف' })] })] }));
    expect(refusal(file).map((item) => item.code).sort()).toEqual(['B0', 'B2']);
    const verbatimOnly = asJson(bulletin());
    expect(guardBulletinFile(verbatimOnly).ok).toBe(true);
  });

  it.each([
    ['an RLO in a label', 'labelAr', 'كمر' + '%sRLO'],
    ['a zero-width space in the MD tokens', 'mdTokens', '38200%sZWSP 38200'],
    ['a BOM in the notes', 'notes', '%sBOM note'],
    ['a control character in the notes', 'notes', 'a%sCTRL b'],
    ['a line break in a label', 'labelAr', 'كمر%sLF وسط'],
  ])('refuses %s, in every text field (S4)', (_label, field, template) => {
    const marks: Record<string, string> = { RLO: String.fromCharCode(0x202e), ZWSP: String.fromCharCode(0x200b), BOM: String.fromCharCode(0xfeff), CTRL: String.fromCharCode(0x07), LF: String.fromCharCode(0x0a) };
    const mark = Object.keys(marks).find((name) => template.includes(name)) as string;
    const value = template.replace(`%s${mark}`, marks[mark]);
    const file = asJson(bulletin({ pages: [page({ rows: [row({ [field]: value })] })] }));
    expect(refusal(file).map((item) => item.code)).toContain('B0');
  });

  it('keeps a line break in the MD tokens and the notes', () => {
    const file = asJson(bulletin({ pages: [page({ rows: [row({ notes: 'line one' + String.fromCharCode(0x0a) + 'line two' })] })] }));
    expect(guardBulletinFile(file).ok).toBe(true);
  });

  it('refuses a non-object input outright', () => {
    expect(refusal([]).map((item) => item.message)).toEqual(['$: expected an object']);
  });
});
