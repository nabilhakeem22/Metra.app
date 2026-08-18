import { describe, expect, it } from 'vitest';
import { parseSpreadsheet } from '@/lib/price-book/parse';

// Not a DB test, but lives under the actions config so `server-only` is aliased.
describe('parseSpreadsheet (CSV)', () => {
  it('parses a CSV file into header + data rows', async () => {
    const csv = 'code,name,cost\nB-1,Door,1800\nB-2,Desk,2500\n';
    const bytes = new TextEncoder().encode(csv);

    const sheet = await parseSpreadsheet(bytes);
    expect(sheet.header).toEqual(['code', 'name', 'cost']);
    expect(sheet.data).toEqual([
      ['B-1', 'Door', '1800'],
      ['B-2', 'Desk', '2500'],
    ]);
  });

  it('handles quoted fields with commas, escaped quotes, and CRLF', async () => {
    const csv = 'code,name\r\n"A-1","Paint, white"\r\n"A-2","1"" pipe"\r\n';
    const bytes = new TextEncoder().encode(csv);

    const sheet = await parseSpreadsheet(bytes);
    expect(sheet.header).toEqual(['code', 'name']);
    expect(sheet.data).toEqual([
      ['A-1', 'Paint, white'],
      ['A-2', '1" pipe'],
    ]);
  });

  it('strips a UTF-8 BOM and skips fully-blank rows', async () => {
    const csv = '﻿code,name\nA-1,Paint\n,\nA-2,Tiles\n';
    const bytes = new TextEncoder().encode(csv);

    const sheet = await parseSpreadsheet(bytes);
    expect(sheet.header).toEqual(['code', 'name']);
    expect(sheet.data).toEqual([
      ['A-1', 'Paint'],
      ['A-2', 'Tiles'],
    ]);
  });

  it('rejects an xlsx (zip) upload — CSV only', async () => {
    // xlsx files are zip archives: the first bytes are "PK" (0x50 0x4B).
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    await expect(parseSpreadsheet(bytes)).rejects.toThrow();
  });

  it('rejects an oversize buffer before parsing', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    await expect(parseSpreadsheet(big)).rejects.toThrow();
  });
});
