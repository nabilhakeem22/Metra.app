import { ORG_A_ID, ORG_B_ID } from '@metra/db';
import { createSql } from '@metra/db/client';
import { MARKET_WRITE_LOCK } from '@metra/db/market-seed';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedCommand } from '../src/commands/seed-command';
import { CLI_APPLICATION_NAME } from '../src/db/connection';
import { describeLockHolders } from '../src/publish/lock-holders';
import { rebuildSeedBook } from '../src/seed/book-store';
import { clearMarketTestData, seedPublished } from './db-fixture';
import { clearSeeded, publishFixture, seededIn, sql } from './seed-fixture';

// R1: a real market:seed-price-books run held the market book with a SESSION
// lock until it ended, so a link that dropped between two studios left an idle
// session blocking every publish and withdrawal, with no timeout to end it.
// Now each studio's transaction holds the book and checks it is the one the
// run planned from; between studios the CLI holds nothing.

const between = vi.hoisted(() => ({ calls: 0, at: 2, probe: async (): Promise<void> => undefined }));
vi.mock('../src/seed/read', async (original) => {
  const real = await original<typeof import('../src/seed/read')>();
  return {
    ...real,
    // Read right before each studio's transaction, after the run's rebuild: call 2 is BETWEEN the two studios.
    readActor: async (...args: Parameters<typeof real.readActor>) => {
      between.calls += 1;
      if (between.calls === between.at) await between.probe();
      return real.readActor(...args);
    },
  };
});

let printed: string[] = [];

beforeEach(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  await publishFixture();
  between.calls = 0;
  between.at = 2;
  between.probe = async () => undefined;
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void printed.push(line));
});

afterAll(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  await rebuildSeedBook(sql);
  await sql.end();
});

/** What a publish does first: take the market write lock exclusively, here without waiting. */
const publishCouldLock = async () =>
  (await sql.begin((tx) => tx`select pg_try_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK})) as got`))[0].got as boolean;

const cliSessions = () => sql<Array<{ state: string; advisory_locks: number }>>`
  select a.state, (select count(*)::int from pg_locks l where l.pid = a.pid and l.locktype = 'advisory' and l.granted) as advisory_locks
    from pg_stat_activity a where a.application_name = ${CLI_APPLICATION_NAME} and a.pid <> pg_backend_pid()`;

const run = () => seedCommand(['--org', ORG_A_ID, '--org', ORG_B_ID]);

describe('market:seed-price-books between two studios', () => {
  it('holds no market lock: its session sits idle, named, and a publish takes the lock at once', async () => {
    let observed: { sessions: Array<{ state: string; advisory_locks: number }>; publish: boolean } | undefined;
    between.probe = async () => {
      observed = { sessions: [...(await cliSessions())], publish: await publishCouldLock() };
    };
    expect(await run()).toBe(0);
    expect(observed).toEqual({ sessions: [{ state: 'idle', advisory_locks: 0 }], publish: true });
    expect(await seededIn(ORG_B_ID)).toHaveLength(3);
  });

  it('stops cleanly when a publish changed the book: the first studio is seeded, the second untouched, and a re-run seeds it from the new book', async () => {
    between.probe = async () => {
      await seedPublished(sql, '2003-10', [{ key: 'raw.steel.dbtest_rebar', unit: 'ton', sourceLabel: 'حديد اختبار', prices: [['2003-10', '40000']] }]);
      await rebuildSeedBook(sql);
    };
    expect(await run()).toBe(1);
    expect(printed).toContain('  STOPPED, nothing written for this studio: the market price book changed during this run (a publish or withdrawal)');
    expect(printed.at(-1)).toMatch(/^STOPPED: the market price book changed during this run\. Run the same command again/);
    expect((await seededIn(ORG_A_ID)).find((item) => item.code === 'MKT-raw.steel.dbtest_rebar')?.cost).toBe('39850.0000');
    expect(await seededIn(ORG_B_ID)).toEqual([]);

    expect(await run()).toBe(0);
    expect((await seededIn(ORG_B_ID)).find((item) => item.code === 'MKT-raw.steel.dbtest_rebar')?.cost).toBe('40000.0000');
  });

  it('a rebuild that stores the same book stops nothing', async () => {
    between.probe = async () => void (await rebuildSeedBook(sql));
    expect(await run()).toBe(0);
    expect(await seededIn(ORG_B_ID)).toHaveLength(3);
  });

  it('a change before the first studio stops the run there: that studio and the one after it are named, nothing written', async () => {
    between.at = 1;
    between.probe = async () => {
      await seedPublished(sql, '2003-10', [{ key: 'raw.steel.dbtest_rebar', unit: 'ton', sourceLabel: 'حديد اختبار', prices: [['2003-10', '41000']] }]);
      await rebuildSeedBook(sql);
    };
    expect(await run()).toBe(1);
    expect(printed.filter((line) => line.startsWith('  STOPPED, nothing written'))).toHaveLength(1);
    expect(printed).toContain('  not reached: the run stopped before this studio');
    expect(between.calls).toBe(1);
    expect(await seededIn(ORG_A_ID)).toEqual([]);
    expect(await seededIn(ORG_B_ID)).toEqual([]);
  });
});

describe('the holder report a blocked publish prints', () => {
  it('names a session-level holder left idle (what an older CLI left behind) as one to end, with its application and age', async () => {
    const orphan = createSql(process.env.DATABASE_URL as string, { max: 1, connection: { application_name: CLI_APPLICATION_NAME } });
    try {
      await orphan`select pg_advisory_lock_shared(hashtext(${MARKET_WRITE_LOCK}))`;
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const report = await describeLockHolders();
      expect(report).toMatch(new RegExp(`pid \\d+ \\(${CLI_APPLICATION_NAME}\\), idle for [1-9]\\d* s, no transaction open: LEFT BEHIND, end it`));
      expect(report).toContain('select pg_terminate_backend(<pid>);');
    } finally {
      await orphan.end();
    }
  });
});
