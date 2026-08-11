import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseSpreadsheet } from '@/lib/price-book/parse';

// Not a DB test, but lives under the actions config so `server-only` is aliased.
describe('parseSpreadsheet (exceljs)', () => {
  it('parses an xlsx workbook into header + data rows', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['code', 'name', 'cost']);
    ws.addRow(['A-1', 'Paint', 100]);
    ws.addRow(['A-2', 'Tiles', 250]);
    const buf = await wb.xlsx.writeBuffer();
    const bytes = new Uint8Array(buf as unknown as ArrayBuffer);

    const sheet = await parseSpreadsheet(bytes);
    expect(sheet.header).toEqual(['code', 'name', 'cost']);
    expect(sheet.data).toEqual([
      ['A-1', 'Paint', '100'],
      ['A-2', 'Tiles', '250'],
    ]);
  });

  it('parses a CSV file into the same shape', async () => {
    const csv = 'code,name,cost\nB-1,Door,1800\nB-2,Desk,2500\n';
    const bytes = new TextEncoder().encode(csv);

    const sheet = await parseSpreadsheet(bytes);
    expect(sheet.header).toEqual(['code', 'name', 'cost']);
    expect(sheet.data).toEqual([
      ['B-1', 'Door', '1800'],
      ['B-2', 'Desk', '2500'],
    ]);
  });

  it('rejects an oversize buffer before parsing', async () => {
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    await expect(parseSpreadsheet(big)).rejects.toThrow();
  });
});
