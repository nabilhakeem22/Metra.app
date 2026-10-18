import { ORG_A_ID } from '@metra/db';
import { createSql, type PostgresJs } from '@metra/db/client';
import { MARKET_WRITE_LOCK, STUDIO_SEED_LOCK } from '@metra/db/market-seed';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CLI_APPLICATION_NAME } from '../src/db/connection';
import { describeLockHolders } from '../src/publish/lock-holders';

// The report a blocked publish or withdraw prints, read from the real
// pg_locks and pg_stat_activity: who holds a MARKET lock in THIS database (and
// nobody else), and whether to wait for it or end it. Every holder is polled
// into the state under test, never slept into it: a slow runner must not
// change what is asserted.

const OTHER_DATABASE = 'metra_dbtest_other';
const POLL_MS = 50;
const STATE_WITHIN_MS = 20_000;

const admin = createSql(process.env.DATABASE_URL as string, { max: 1 });
const opened: PostgresJs[] = [];

function session(applicationName: string, database?: string): PostgresJs {
  const url = new URL(process.env.DATABASE_URL as string);
  if (database) url.pathname = `/${database}`;
  const connection = createSql(url.toString(), { max: 1, connection: { application_name: applicationName } });
  opened.push(connection);
  return connection;
}

beforeAll(async () => {
  const [present] = await admin`select 1 as yes from pg_database where datname = ${OTHER_DATABASE}`;
  if (!present) await admin.unsafe(`create database ${OTHER_DATABASE}`);
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((connection) => connection.end({ timeout: 1 })));
});

afterAll(async () => {
  await admin.unsafe(`drop database if exists ${OTHER_DATABASE} with (force)`);
  await admin.end();
});

const pidOf = async (connection: PostgresJs) => (await connection`select pg_backend_pid() as pid`)[0].pid as number;

/** Waits until session `pid` is in `state` (and, when given, waiting on `waitEvent`). */
async function untilState(pid: number, state: string, waitEvent?: string): Promise<void> {
  for (let waited = 0; waited < STATE_WITHIN_MS; waited += POLL_MS) {
    const [row] = await admin<Array<{ state: string; wait_event: string | null }>>`select state, wait_event from pg_stat_activity where pid = ${pid}`;
    if (row?.state === state && (waitEvent === undefined || row.wait_event === waitEvent)) return;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`session ${pid} never reached state ${state}${waitEvent ? ` waiting on ${waitEvent}` : ''}`);
}

/** A transaction holding the market write lock exclusively, as a publish does, then running `next` until released. */
function publishHolding(connection: PostgresJs, next: (tx: PostgresJs) => Promise<unknown>) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  const done = connection.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK}))`;
    await next(tx as unknown as PostgresJs);
    await released;
  });
  return { done, release: async () => { release(); await done; } };
}

/** The report's line for `pid`, or undefined when it is not listed. */
const lineOf = (report: string, pid: number) => report.split('\n').find((line) => line.startsWith(`  pid ${pid} `));

describe('the holder report', () => {
  it('names a session-level holder left idle (what an older CLI left behind) as one to end, with its application and age', async () => {
    const orphan = session(CLI_APPLICATION_NAME);
    const pid = await pidOf(orphan);
    await orphan`select pg_advisory_lock_shared(hashtext(${MARKET_WRITE_LOCK}))`;
    await untilState(pid, 'idle');
    const report = await describeLockHolders();
    expect(lineOf(report, pid)).toMatch(new RegExp(`^  pid ${pid} [(]${CLI_APPLICATION_NAME}[)], idle for [0-9]+ s, no transaction open: LEFT BEHIND, end it$`));
    expect(report).toContain('select pg_terminate_backend(<pid>);');
  });

  it('calls a publish running a long statement "running"', async () => {
    const publish = session(CLI_APPLICATION_NAME);
    const pid = await pidOf(publish);
    const holding = publishHolding(publish, (tx) => tx`select pg_sleep(30)`);
    await untilState(pid, 'active', 'PgSleep');
    expect(lineOf(await describeLockHolders(), pid)).toMatch(/, active for [0-9]+ s, transaction open [0-9]+ s: running, wait for it$/);
    await admin`select pg_cancel_backend(${pid})`;
    await expect(holding.done).rejects.toMatchObject({ code: '57014' });
  });

  it('calls a slow-link publish between two statements "running"', async () => {
    const publish = session(CLI_APPLICATION_NAME);
    const pid = await pidOf(publish);
    const holding = publishHolding(publish, async () => undefined);
    await untilState(pid, 'idle in transaction');
    expect(lineOf(await describeLockHolders(), pid)).toMatch(/, idle in transaction for [0-9]+ s, transaction open [0-9]+ s: running, wait for it$/);
    await holding.release();
  });

  it('lists a studio seed holding its studio lock', async () => {
    const seed = session(CLI_APPLICATION_NAME);
    const pid = await pidOf(seed);
    const holding = seed.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${STUDIO_SEED_LOCK}), hashtext(${ORG_A_ID}))`;
      await untilState(pid, 'idle in transaction');
      return describeLockHolders();
    });
    expect(lineOf(await holding, pid)).toContain(`(${CLI_APPLICATION_NAME})`);
  });

  it('lists no session holding some other advisory key, one-key or two-key', async () => {
    const other = session('some-other-service');
    const pid = await pidOf(other);
    await other`select pg_advisory_lock(424242), pg_advisory_lock(1, 2), pg_advisory_lock(-5)`;
    expect(lineOf(await describeLockHolders(), pid)).toBeUndefined();
  });

  it('lists no session of another database on the same server, even one holding the market keys there', async () => {
    const elsewhere = session('other-database', OTHER_DATABASE);
    const pid = await pidOf(elsewhere);
    await elsewhere`select pg_advisory_lock(hashtext(${MARKET_WRITE_LOCK})), pg_advisory_lock(hashtext(${STUDIO_SEED_LOCK}), 1)`;
    expect(lineOf(await describeLockHolders(), pid)).toBeUndefined();
  });
});
