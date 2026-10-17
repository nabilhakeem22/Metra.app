import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readCatalogue } from '../src/catalogue';
import { HISTORY_VALIDATORS } from '../src/check/history';
import { runCheck } from '../src/check/run';
import type { MarketBulletinFileV1 } from '../src/format';
import { loadHistory } from '../src/history/load';
import { asJson, bulletin, months, page, printedCells, row } from '../src/testing/fixtures';
import { clearMarketTestData, openTestDatabase, seedPublished } from './db-fixture';

// The checks that read the published history (task 9): B6, B7, B11, F2, F3,
// and F1 against an earlier bulletin, on a local database seeded with ONE
// published bulletin (2003-05).

const sql = openTestDatabase();
const PERIOD = '2003-06';
const SLOTS = months('3800', '3800', '3800', '3850', '3900', '3900');

beforeAll(() => clearMarketTestData(sql));
afterAll(async () => {
  await clearMarketTestData(sql);
  await sql.end();
});

beforeEach(async () => {
  await clearMarketTestData(sql);
  await seedPublished(sql, '2003-05', [
    { key: 'raw.steel.dbtest_cement', unit: 'ton', sourceLabel: 'اسمنت رمادي', prices: [['2003-04', '3800'], ['2003-05', '3900']] },
    { key: 'raw.steel.dbtest_dropped', unit: 'ton', sourceLabel: 'بند قديم', prices: [['2003-05', '100']] },
    { key: 'raw.steel.dbtest_roll', unit: 'roll', sourceLabel: 'سلك', pack: { lengthM: 100, pieces: null, pieceLengthM: null } },
  ], { pdfSha256: 'e'.repeat(64) });
});

function fileWith(rows: ReturnType<typeof row>[], pdfSha256 = 'f'.repeat(64)): MarketBulletinFileV1 {
  return bulletin({
    period: PERIOD,
    source: { ...bulletin().source, pdfSha256 },
    pages: [page({ rows, yearly: null, legendLabelsAr: rows.map((item) => item.labelAr) })],
  });
}

async function check(file: MarketBulletinFileV1, mapping?: unknown) {
  const history = await loadHistory(sql, PERIOD);
  const outcome = runCheck({
    period: PERIOD,
    producerFiles: [{ name: 'bulletin.json', value: asJson(file) }],
    mapping,
    corrections: undefined,
    history,
    historyValidators: HISTORY_VALIDATORS,
    flagPct: 15,
    sourceHashes: { pdf: null, md: null },
  });
  return outcome.findings.filter((item) => item.code !== 'F4').map((item) => `${item.code} ${item.rowId ?? item.message}`);
}

const cementRow = (overrides: Parameters<typeof row>[0] = {}) =>
  row({ proposedKey: 'raw.steel.dbtest_cement', labelAr: 'اسمنت', specAr: 'رمادي', months: SLOTS, verbatimCells: printedCells(SLOTS), ...overrides });

describe('market:check against the published history', () => {
  it('F2 names a restated month, and F3 the item that dropped out', async () => {
    expect(await check(fileWith([cementRow()]))).toEqual([
      'F2 p2.r1',
      'F3 raw.steel.dbtest_dropped has published prices and is missing from this bulletin',
    ]);
  });

  it('B6: a published key read in another unit, and a roll read with another pack', async () => {
    const roll = row({ rowId: 'p2.r2', proposedKey: 'raw.steel.dbtest_roll', labelAr: 'سلك', unitLabelAr: 'اللفة (45 متر)' });
    const findings = await check(fileWith([cementRow({ unitLabelAr: 'كجم' }), roll]));
    expect(findings.filter((item) => item.startsWith('B6'))).toEqual(['B6 p2.r1', 'B6 p2.r2']);
  });

  it('B7: a new key that reads exactly like a published item, unless the unit differs', async () => {
    const twin = cementRow({ proposedKey: 'raw.steel.dbtest_cement_again' });
    expect(await check(fileWith([twin]))).toContain('B7 p2.r1');
    const stairs = cementRow({ proposedKey: 'raw.steel.dbtest_cement_stairs', unitLabelAr: 'م.ط' });
    expect((await check(fileWith([stairs]))).filter((item) => item.startsWith('B7'))).toEqual([]);
    const mapped = await check(fileWith([twin]), { 'p2.r1': { action: 'map', itemKey: 'raw.steel.dbtest_cement' } });
    expect(mapped.filter((item) => item.startsWith('B7'))).toEqual([]);
  });

  it('B11: the same PDF already published for another period', async () => {
    expect(await check(fileWith([cementRow()], 'e'.repeat(64)))).toContain('B11 this PDF is already published as the 2003-05 bulletin');
  });

  it('F1 compares this file with the published history', async () => {
    const juneOnly = months(null, null, null, null, null, '5000');
    const findings = await check(fileWith([cementRow({ months: juneOnly, verbatimCells: printedCells(juneOnly) })]));
    expect(findings).toContain('F1 p2.r1');
  });

  it('a discontinue in mapping.json clears F3 for that item', async () => {
    const findings = await check(fileWith([cementRow()]), { 'p2.r1': { action: 'discontinue', itemKey: 'raw.steel.dbtest_dropped' } });
    expect(findings).toEqual(['F2 p2.r1']);
  });

  it('B0: discontinue of a key that is not an active published item', async () => {
    const findings = await check(fileWith([cementRow()]), { 'p2.r1': { action: 'discontinue', itemKey: 'raw.steel.dbtest_nothing' } });
    expect(findings).toContain('B0 mapping.json discontinues raw.steel.dbtest_nothing, which is not an active published item');
  });
});

describe('market:catalogue', () => {
  it('lists the published items with unit, pack and labels, sorted by key', async () => {
    const items = (await readCatalogue(sql)).filter((item) => item.key.includes('.dbtest_'));
    expect(items.map((item) => item.key)).toEqual(['raw.steel.dbtest_cement', 'raw.steel.dbtest_dropped', 'raw.steel.dbtest_roll']);
    expect(items[2]).toMatchObject({ unit: 'roll', pack: { lengthM: 100, pieces: null, pieceLengthM: null }, sourceLabels: ['سلك'] });
  });
});
