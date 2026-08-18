import { describe, expect, it, vi } from 'vitest';

// parse.ts is server-only; the `server-only` guard throws under plain vitest, so
// stub it (the parser itself has no runtime dependency on it).
vi.mock('server-only', () => ({}));

const { MAX_IMPORT_ROWS, parseSpreadsheet, SpreadsheetError } = await import(
  './parse'
);

const encode = (text: string) => new TextEncoder().encode(text);

async function parse(text: string) {
  return parseSpreadsheet(encode(text));
}

async function reasonOf(text: string): Promise<string> {
  try {
    await parse(text);
    return 'ok';
  } catch (err) {
    if (err instanceof SpreadsheetError) return err.reason;
    throw err;
  }
}

describe('parseSpreadsheet — CSV quote handling (A1)', () => {
  it('keeps a lone mid-field quote literal and does NOT collapse later rows', async () => {
    // Repro from the bug report: the `"` in `3" pipe` must not open quote mode
    // and swallow everything to EOF.
    const { rows } = await parse('code,name,cost\nA-1,3" pipe,120\nA-2,Door,1800\n');
    expect(rows).toEqual([
      ['code', 'name', 'cost'],
      ['A-1', '3" pipe', '120'],
      ['A-2', 'Door', '1800'],
    ]);
  });

  it('still parses a fully-quoted field with an embedded comma', async () => {
    const { rows } = await parse('code,name\nA-1,"Paint, white"\n');
    expect(rows).toEqual([
      ['code', 'name'],
      ['A-1', 'Paint, white'],
    ]);
  });

  it('unescapes a doubled quote inside a quoted field ("" -> ")', async () => {
    const { rows } = await parse('code,name\nA-1,"1"" pipe"\n');
    expect(rows).toEqual([
      ['code', 'name'],
      ['A-1', '1" pipe'],
    ]);
  });

  it('keeps an embedded newline inside a quoted field literal', async () => {
    const { rows } = await parse('code,name\nA-1,"line1\nline2"\n');
    expect(rows).toEqual([
      ['code', 'name'],
      ['A-1', 'line1\nline2'],
    ]);
  });

  it('appends characters after a closing quote literally (lenient)', async () => {
    const { rows } = await parse('code,name\nA-1,"abc"def\n');
    expect(rows).toEqual([
      ['code', 'name'],
      ['A-1', 'abcdef'],
    ]);
  });

  it('handles CRLF terminators and trailing quote content', async () => {
    const { rows } = await parse('code,name\r\nA-1,3" pipe\r\n');
    expect(rows).toEqual([
      ['code', 'name'],
      ['A-1', '3" pipe'],
    ]);
  });
});

describe('parseSpreadsheet — row caps (A3)', () => {
  const dataRow = (n: number) => `A-${n},item,1\n`;
  const header = 'code,name,cost\n';

  it('accepts exactly MAX_IMPORT_ROWS data rows', async () => {
    let csv = header;
    for (let i = 0; i < MAX_IMPORT_ROWS; i += 1) csv += dataRow(i);
    const { data } = await parse(csv);
    expect(data).toHaveLength(MAX_IMPORT_ROWS);
  });

  it('rejects MAX_IMPORT_ROWS + 1 data rows with too_many_rows', async () => {
    let csv = header;
    for (let i = 0; i < MAX_IMPORT_ROWS + 1; i += 1) csv += dataRow(i);
    expect(await reasonOf(csv)).toBe('too_many_rows');
  });

  it('rejects a pathological huge-row-count input with too_many_rows (bails early, not empty)', async () => {
    // 60k blank-ish rows: without the parse-time ceiling this would build the
    // whole matrix before the fine check. It must reject as too_many_rows.
    const csv = header + 'a\n'.repeat(60_000);
    expect(await reasonOf(csv)).toBe('too_many_rows');
  });
});
