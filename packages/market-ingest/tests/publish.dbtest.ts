import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCommand } from '../src/commands/check-command';
import { publishCommand } from '../src/commands/publish-command';
import { withdrawCommand } from '../src/commands/withdraw-command';
import type { MarketBulletinFileV1 } from '../src/format';
import { jsonBytes, sha256Hex } from '../src/staging';
import { asJson, bulletin, months, page, printedCells, row } from '../src/testing/fixtures';
import { REVIEWER, clearMarketTestData, openTestDatabase } from './db-fixture';

// market:publish and market:withdraw on a local database (plan AC 6 to 8).

const sql = openTestDatabase();
const PERIOD = '2004-07';
let staging: string;

const ROLL = months('2050', '2050', '2050', '2050', '2050', '2050', '2100');
function file(price = '39850'): MarketBulletinFileV1 {
  const slots = months('38200', '38200', '38200', price, price, price, price);
  return bulletin({
    period: PERIOD,
    pages: [page({
      yearly: null,
      defaultUnitLabelAr: null,
      legendLabelsAr: ['حديد', 'سلك'],
      rows: [
        row({ proposedKey: 'raw.steel.dbtest_rebar', months: slots, verbatimCells: printedCells(slots) }),
        row({ rowId: 'p2.r2', proposedKey: 'raw.steel.dbtest_wire', labelAr: 'سلك', unitLabelAr: 'اللفة (100 م.ط)', months: ROLL, verbatimCells: printedCells(ROLL) }),
      ],
    })],
  });
}

const paths = () => ({ bulletin: join(staging, PERIOD, 'bulletin.json'), staged: join(staging, PERIOD, 'staged.json') });

async function stage(value: unknown): Promise<string> {
  mkdirSync(join(staging, PERIOD), { recursive: true });
  writeFileSync(paths().bulletin, JSON.stringify(asJson(value)));
  await checkCommand(['--period', PERIOD]);
  return sha256Hex(readFileSync(paths().staged));
}

async function counts(): Promise<number[]> {
  const [row] = await sql<Array<{ c: number; i: number; b: number; o: number }>>`
    select (select count(*) from market_categories)::int c, (select count(*) from market_items)::int i,
           (select count(*) from market_bulletins)::int b, (select count(*) from market_price_observations)::int o`;
  return [row.c, row.i, row.b, row.o];
}

const publish = (approve: string, extra: string[] = []) => publishCommand(['--period', PERIOD, '--approve', approve, '--reviewer', REVIEWER, ...extra]);

beforeEach(async () => {
  await clearMarketTestData(sql);
  staging = mkdtempSync(join(tmpdir(), 'market-publish-'));
  vi.stubEnv('MARKET_STAGING_DIR', staging);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  rmSync(staging, { recursive: true, force: true });
  await clearMarketTestData(sql);
  await sql.end();
});

describe('market:publish', () => {
  it('publishes an approved staged.json: items with their pack, the bulletin, every observation', async () => {
    const sha = await stage(file());
    expect(await publish(sha)).toBe(0);
    const items = await sql`select key, unit, pack_length_m::text, status from market_items where key like 'raw.steel.dbtest%' order by key`;
    expect(items).toEqual([
      { key: 'raw.steel.dbtest_rebar', unit: 'ton', pack_length_m: null, status: 'active' },
      { key: 'raw.steel.dbtest_wire', unit: 'roll', pack_length_m: '100.000', status: 'active' },
    ]);
    const [published] = await sql`select status, extraction_method, extraction_sha256, source_pdf_sha256, reviewed_by from market_bulletins where period_month = '2004-07-01'`;
    expect(published).toEqual({ status: 'published', extraction_method: 'session:pdf', extraction_sha256: sha, source_pdf_sha256: 'a'.repeat(64), reviewed_by: REVIEWER });
    const [observed] = await sql`select count(*)::int n, min(source_pdf_page) p, min(source_printed_page) q from market_price_observations o join market_bulletins b on b.id = o.bulletin_id where b.period_month = '2004-07-01'`;
    expect(observed).toEqual({ n: 14, p: 2, q: 1 });
  });

  it('AC 6: refuses a hash that is not sha256(staged.json), and writes nothing', async () => {
    await stage(file());
    const before = await counts();
    await expect(publish('0'.repeat(64))).rejects.toThrow('not the approved');
    expect(await counts()).toEqual(before);
  });

  it('AC 7: refuses a staged.json with blocking findings and lists every one', async () => {
    const broken = asJson(file());
    broken.pages[0].rows[0].months[0] = '1596029811';
    broken.pages[0].rows[1].unitLabelAr = 'برميل';
    const sha = await stage(broken);
    const before = await counts();
    const failure = publish(sha);
    await expect(failure).rejects.toThrow(/blocking finding\(s\); nothing was written/);
    await expect(publish(sha)).rejects.toThrow(/B2 Values[\s\S]*B3 Units[\s\S]*B12 Verbatim/);
    expect(await counts()).toEqual(before);
  });

  it('AC 8: a second bulletin for the period needs --replace, which withdraws the first in the same transaction', async () => {
    expect(await publish(await stage(file()))).toBe(0);
    const second = await stage(file('40000'));
    await expect(publish(second)).rejects.toThrow('already published; pass --replace');
    expect(await publish(second, ['--replace'])).toBe(0);
    const rows = await sql`select status, withdrawn_reason, extraction_sha256 = ${second} as is_second from market_bulletins where period_month = '2004-07-01' order by published_at`;
    expect(rows).toEqual([
      { status: 'withdrawn', withdrawn_reason: 'replaced', is_second: false },
      { status: 'published', withdrawn_reason: null, is_second: true },
    ]);
  });

  it('rolls everything back when a step fails half-way', async () => {
    await stage(file());
    const staged = JSON.parse(readFileSync(paths().staged, 'utf8'));
    staged.discontinue = ['raw.steel.dbtest_never_published'];
    const bytes = jsonBytes(staged);
    writeFileSync(paths().staged, bytes);
    const before = await counts();
    await expect(publish(sha256Hex(bytes))).rejects.toThrow('cannot discontinue raw.steel.dbtest_never_published');
    expect(await counts()).toEqual(before);
  });
});

describe('market:withdraw', () => {
  it('withdraws the published bulletin, and refuses when there is none', async () => {
    expect(await publish(await stage(file()))).toBe(0);
    expect(await withdrawCommand(['--period', PERIOD, '--reason', 'wrong file'])).toBe(0);
    const [row] = await sql`select status, withdrawn_reason from market_bulletins where period_month = '2004-07-01'`;
    expect(row).toEqual({ status: 'withdrawn', withdrawn_reason: 'wrong file' });
    await expect(withdrawCommand(['--period', PERIOD, '--reason', 'again'])).rejects.toThrow('no published bulletin for 2004-07');
    await expect(withdrawCommand(['--period', PERIOD])).rejects.toThrow('--reason');
  });
});
