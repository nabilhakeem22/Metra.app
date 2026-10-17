import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonBytes, sha256Hex } from '../src/staging';
import { asJson } from '../src/testing/fixtures';
import { REVIEWER, clearMarketTestData, openTestDatabase } from './db-fixture';
import { GATE_COMMIT, bulletinFile, newStaging, periodDir, publish, stage, type Staging } from './publish-fixture';

// market:publish on a local database (plan AC 6 to 8, and the fix round's S2
// and F2): publish re-runs the gate inside its transaction and writes what it
// computed, so only the approved output of the committed gate is ever written.

const gate = vi.hoisted(() => ({ changedFiles: [] as string[] }));
vi.mock('../src/gate', async (original) => ({
  ...(await original<typeof import('../src/gate')>()),
  readGate: () => ({ commit: 'f'.repeat(40), changedFiles: gate.changedFiles }),
}));

const sql = openTestDatabase();
const PERIOD = '2004-07';
let staging: Staging;

async function counts(): Promise<number[]> {
  const [row] = await sql<Array<{ c: number; i: number; b: number; o: number; d: number }>>`
    select (select count(*) from market_categories)::int c, (select count(*) from market_items)::int i,
           (select count(*) from market_bulletins)::int b, (select count(*) from market_price_observations)::int o,
           (select count(*) from market_item_details)::int d`;
  return [row.c, row.i, row.b, row.o, row.d];
}

beforeEach(async () => {
  await clearMarketTestData(sql);
  gate.changedFiles = [];
  staging = newStaging();
  vi.stubEnv('MARKET_STAGING_DIR', staging.dir);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  rmSync(staging.dir, { recursive: true, force: true });
  await clearMarketTestData(sql);
  await sql.end();
});

describe('market:publish', () => {
  it('publishes what the gate computes: items with their pack and details, the bulletin with the gate commit', async () => {
    const sha = await stage(staging, bulletinFile(staging));
    expect(await publish(staging, PERIOD, sha)).toBe(0);
    const items = await sql`select key, unit, pack_length_m::text, status, name_en from market_items where key like 'raw.steel.dbtest%' order by key`;
    expect(items).toEqual([
      { key: 'raw.steel.dbtest_rebar', unit: 'ton', pack_length_m: null, status: 'active', name_en: 'Reinforcing steel' },
      { key: 'raw.steel.dbtest_wire', unit: 'roll', pack_length_m: '100.000', status: 'active', name_en: 'Reinforcing steel' },
    ]);
    const [published] = await sql`select status, extraction_method, extraction_sha256, gate_commit, reviewed_by from market_bulletins where period_month = '2004-07-01'`;
    expect(published).toEqual({ status: 'published', extraction_method: 'session:pdf', extraction_sha256: sha, gate_commit: GATE_COMMIT, reviewed_by: REVIEWER });
    const [observed] = await sql`select count(*)::int n, min(bulletin_period_month)::text m from market_price_observations o join market_bulletins b on b.id = o.bulletin_id where b.period_month = '2004-07-01'`;
    expect(observed).toEqual({ n: 14, m: '2004-07-01' });
    expect((await counts())[4]).toBeGreaterThanOrEqual(2);
  });

  it('AC 6: refuses a hash the gate does not compute, and writes nothing', async () => {
    await stage(staging, bulletinFile(staging));
    const before = await counts();
    await expect(publish(staging, PERIOD, '0'.repeat(64))).rejects.toThrow('not the approved');
    expect(await counts()).toEqual(before);
  });

  it('S2: a hand-written staged.json is never published, even with its own hash', async () => {
    await stage(staging, bulletinFile(staging));
    const path = join(periodDir(staging, PERIOD), 'staged.json');
    const forged = JSON.parse(readFileSync(path, 'utf8'));
    forged.observations[0].price = '99999999999999';
    const bytes = jsonBytes(forged);
    writeFileSync(path, bytes);
    const before = await counts();
    await expect(publish(staging, PERIOD, sha256Hex(bytes))).rejects.toThrow('the gate computes');
    expect(await counts()).toEqual(before);
  });

  it('S2: refuses to run when the gate code differs from its commit', async () => {
    const sha = await stage(staging, bulletinFile(staging));
    gate.changedFiles = ['packages/market-ingest/src/check/slots.ts'];
    await expect(publish(staging, PERIOD, sha)).rejects.toThrow('the gate code differs from commit');
  });

  it('F2: refuses a hash that was reviewed offline', async () => {
    const sha = await stage(staging, bulletinFile(staging), { offline: true });
    await expect(publish(staging, PERIOD, sha)).rejects.toThrow('checked with --offline, which publish never accepts');
  });

  it('refuses without --pdf when the bulletin names a PDF', async () => {
    const sha = await stage(staging, bulletinFile(staging));
    const { publishCommand } = await import('../src/commands/publish-command');
    await expect(publishCommand(['--period', PERIOD, '--approve', sha, '--reviewer', REVIEWER])).rejects.toThrow('pass --pdf');
  });

  it('AC 7: refuses blocking findings and lists every one', async () => {
    const broken = asJson(bulletinFile(staging));
    broken.pages[0].rows[0].months[0] = '1596029811';
    broken.pages[0].rows[1].unitLabelAr = 'برميل';
    const sha = await stage(staging, broken);
    const before = await counts();
    await expect(publish(staging, PERIOD, sha)).rejects.toThrow(/blocking finding\(s\); nothing was written[\s\S]*B2 Values[\s\S]*B3 Units[\s\S]*B12 Verbatim/);
    expect(await counts()).toEqual(before);
  });

  it('AC 8: a second bulletin for the period needs --replace, which withdraws the first in the same transaction', async () => {
    expect(await publish(staging, PERIOD, await stage(staging, bulletinFile(staging)))).toBe(0);
    const second = await stage(staging, bulletinFile(staging, { price: '40000' }));
    await expect(publish(staging, PERIOD, second)).rejects.toThrow('already published; pass --replace');
    expect(await publish(staging, PERIOD, second, ['--replace'])).toBe(0);
    const rows = await sql`select status, withdrawn_reason, extraction_sha256 = ${second} as is_second from market_bulletins where period_month = '2004-07-01' order by published_at`;
    expect(rows).toEqual([
      { status: 'withdrawn', withdrawn_reason: 'replaced', is_second: false },
      { status: 'published', withdrawn_reason: null, is_second: true },
    ]);
  });
});
