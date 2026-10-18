import { ORG_A_ID } from '@metra/db';
import { createSql, type PostgresJs } from '@metra/db/client';
import { MARKET_WRITE_LOCK, STUDIO_SEED_LOCK } from '@metra/db/market-seed';
import { afterEach, describe, expect, it } from 'vitest';
import { CLI_APPLICATION_NAME } from '../src/db/connection';
import { describeLockHolders } from '../src/publish/lock-holders';

// The report a blocked publish or withdraw prints, read from the real
// pg_locks and pg_stat_activity: who holds a MARKET lock (and nobody else),
// and whether to wait for it or end it.

const opened: PostgresJs[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((connection) => connection.end({ timeout: 1 })));
});

function session(applicationName: string): PostgresJs {
  const connection = createSql(process.env.DATABASE_URL as string, { max: 1, connection: { application_name: applicationName } });
  opened.push(connection);
  return connection;
}

const pidOf = async (connection: PostgresJs) => (await connection`select pg_backend_pid() as pid`)[0].pid as number;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A transaction holding the market write lock exclusively, as a publish does, until `release`. */
function publishHolding(connection: PostgresJs, during: (tx: PostgresJs) => Promise<void>) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const done = connection.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK}))`;
    await during(tx as unknown as PostgresJs);
    await released;
  });
  return { release: async () => { release(); await done; } };
}

describe('the holder report', () => {
  it('names a session-level holder left idle (what an older CLI left behind) as one to end, with its application and age', async () => {
    const orphan = session(CLI_APPLICATION_NAME);
    await orphan`select pg_advisory_lock_shared(hashtext(${MARKET_WRITE_LOCK}))`;
    await pause(1100);
    const report = await describeLockHolders();
    expect(report).toMatch(new RegExp(`pid ${await pidOf(orphan)} [(]${CLI_APPLICATION_NAME}[)], idle for [1-9][0-9]* s, no transaction open: LEFT BEHIND, end it`));
    expect(report).toContain('select pg_terminate_backend(<pid>);');
  });

  it('calls a publish running a long statement "running"', async () => {
    const publish = session(CLI_APPLICATION_NAME);
    const pid = await pidOf(publish);
    const holding = publishHolding(publish, async (tx) => void (await tx`select pg_sleep(2)`));
    await pause(1000);
    expect(await describeLockHolders()).toMatch(new RegExp(`pid ${pid} [(]${CLI_APPLICATION_NAME}[)], active for [0-9]+ s, transaction open [0-9]+ s: running, wait for it`));
    await holding.release();
  });

  it('calls a slow-link publish between two statements "running"', async () => {
    const publish = session(CLI_APPLICATION_NAME);
    const pid = await pidOf(publish);
    const holding = publishHolding(publish, async () => undefined);
    await pause(1000);
    expect(await describeLockHolders()).toMatch(new RegExp(`pid ${pid} [(]${CLI_APPLICATION_NAME}[)], idle in transaction for [0-9]+ s, transaction open [0-9]+ s: running, wait for it`));
    await holding.release();
  });

  it('lists a studio seed holding its studio lock', async () => {
    const seed = session(CLI_APPLICATION_NAME);
    const pid = await pidOf(seed);
    const holding = publishHolding(seed, async (tx) => void (await tx`select pg_advisory_xact_lock(hashtext(${STUDIO_SEED_LOCK}), hashtext(${ORG_A_ID}))`));
    await pause(200);
    expect(await describeLockHolders()).toContain(`pid ${pid} (${CLI_APPLICATION_NAME})`);
    await holding.release();
  });

  it('lists no session holding some other advisory key, one-key or two-key', async () => {
    const other = session('some-other-service');
    const pid = await pidOf(other);
    await other`select pg_advisory_lock(424242), pg_advisory_lock(1, 2), pg_advisory_lock(-5)`;
    const report = await describeLockHolders();
    expect(report).not.toContain(`pid ${pid} `);
    expect(report).not.toContain('some-other-service');
  });
});
