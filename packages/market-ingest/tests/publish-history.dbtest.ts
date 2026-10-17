import { rmSync } from 'node:fs';
import { MARKET_WRITE_LOCK } from '@metra/db/market-seed';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withdrawCommand } from '../src/commands/withdraw-command';
import { clearMarketTestData, openTestDatabase } from './db-fixture';
import { bulletinFile, newStaging, publish, stage, type Staging } from './publish-fixture';

// What a publish and a withdrawal do to the items beyond their prices (fix
// round F3 and F4), that a failure half-way writes nothing, and that a market
// write stuck behind a lock fails in 3 s and names the holder (R1).

vi.mock('../src/gate', async (original) => ({
  ...(await original<typeof import('../src/gate')>()),
  readGate: () => ({ commit: 'f'.repeat(40), changedFiles: [] }),
}));
const failObservations = vi.hoisted(() => ({ on: false }));
vi.mock('../src/publish/writes', async (original) => {
  const real = await original<typeof import('../src/publish/writes')>();
  return {
    ...real,
    insertObservations: (...args: Parameters<typeof real.insertObservations>) => {
      if (failObservations.on) throw new Error('injected failure after the items were written');
      return real.insertObservations(...args);
    },
  };
});

const sql = openTestDatabase();
let staging: Staging;

const nameOf = async (key: string) => (await sql<Array<{ name_ar: string; name_en: string; status: string }>>`
  select name_ar, name_en, status from market_items where key = ${key}`)[0];

beforeEach(async () => {
  await clearMarketTestData(sql);
  failObservations.on = false;
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

describe('item details follow the newest published bulletin (F3)', () => {
  it('a corrected --replace corrects the names studios see', async () => {
    expect(await publish(staging, '2004-07', await stage(staging, bulletinFile(staging)))).toBe(0);
    const corrected = await stage(staging, bulletinFile(staging, { labelAr: 'حديد تسليح مصحح', nameEn: 'Corrected name' }));
    expect(await publish(staging, '2004-07', corrected, ['--replace'])).toBe(0);
    expect(await nameOf('raw.steel.dbtest_rebar')).toMatchObject({ name_ar: 'حديد تسليح مصحح', name_en: 'Corrected name' });
  });

  it('a withdrawal restores the previous bulletin wording', async () => {
    expect(await publish(staging, '2004-06', await stage(staging, bulletinFile(staging, { period: '2004-06' })))).toBe(0);
    expect(await publish(staging, '2004-07', await stage(staging, bulletinFile(staging, { nameEn: 'July name' })))).toBe(0);
    expect((await nameOf('raw.steel.dbtest_rebar')).name_en).toBe('July name');
    expect(await withdrawCommand(['--period', '2004-07', '--reason', 'wrong file'])).toBe(0);
    expect((await nameOf('raw.steel.dbtest_rebar')).name_en).toBe('Reinforcing steel');
  });
});

describe('a withdrawal undoes its discontinues (F4)', () => {
  it('reactivates what the bulletin discontinued, and the same mapping checks clean again', async () => {
    expect(await publish(staging, '2004-06', await stage(staging, bulletinFile(staging, { period: '2004-06' })))).toBe(0);
    const mapping = { 'p2.r1': { action: 'discontinue', itemKey: 'raw.steel.dbtest_wire' } };
    const july = await stage(staging, bulletinFile(staging, { withWire: false }), { mapping });
    expect(await publish(staging, '2004-07', july)).toBe(0);
    expect((await nameOf('raw.steel.dbtest_wire')).status).toBe('discontinued');
    expect(await withdrawCommand(['--period', '2004-07', '--reason', 'wrong file'])).toBe(0);
    expect((await nameOf('raw.steel.dbtest_wire')).status).toBe('active');
    expect(await stage(staging, bulletinFile(staging, { withWire: false }), { mapping })).toBe(july);
  });
});

describe('everything or nothing', () => {
  it('rolls back the categories, items and bulletin when a later step fails', async () => {
    const sha = await stage(staging, bulletinFile(staging));
    failObservations.on = true;
    await expect(publish(staging, '2004-07', sha)).rejects.toThrow('injected failure');
    const [left] = await sql<Array<{ items: number; bulletins: number }>>`
      select (select count(*) from market_items where key like 'raw.steel.dbtest%')::int items,
             (select count(*) from market_bulletins where period_month = '2004-07-01')::int bulletins`;
    expect(left).toEqual({ items: 0, bulletins: 0 });
  });
});

describe('a market write behind a stuck one (R1)', () => {
  it('withdraw fails within the lock timeout and names the holder and the line that ends it', async () => {
    expect(await publish(staging, '2004-07', await stage(staging, bulletinFile(staging)))).toBe(0);
    const holder = openTestDatabase();
    const held = holder.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK}))`;
      await tx`select pg_sleep(6)`;
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    const started = Date.now();
    await expect(withdrawCommand(['--period', '2004-07', '--reason', 'stuck'])).rejects.toThrow(/55P03[\s\S]*pid \d+[\s\S]*pg_terminate_backend/);
    expect(Date.now() - started).toBeLessThan(5_000);
    await held;
    await holder.end();
    expect(await withdrawCommand(['--period', '2004-07', '--reason', 'after the holder ended'])).toBe(0);
  });
});
