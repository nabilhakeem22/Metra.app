import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ORG_A_ID, ORG_B_ID } from '@metra/db';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLI_APPLICATION_NAME } from '../src/db/connection';
import { clearMarketTestData } from './db-fixture';
import { clearSeeded, publishFixture, seededIn, sql } from './seed-fixture';

// Overnight round, R3: the CLI's backend terminated while it wrote a studio
// (a dropped link ends the same way) aborted the whole run with one line, no
// per-studio report and no totals. It runs the REAL CLI in its own process:
// on a server that closes cleanly after its FATAL message (Linux, Supabase),
// postgres.js then throws an uncaught TypeError from its own ROLLBACK on the
// closed connection (db/driver-close-guard.ts), which would otherwise kill
// the CLI before it prints, and fail any test process it ran in.

const PACKAGE_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const POLL_MS = 50;
const FIND_THE_WRITE_WITHIN_MS = 30_000;

beforeEach(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  await publishFixture();
  await sql.unsafe(`create function dbtest_slow_seed() returns trigger language plpgsql as $$
    begin perform pg_sleep(30); return null; end $$`);
  await sql.unsafe('create trigger dbtest_slow_seed before insert on cost_items for each statement execute function dbtest_slow_seed()');
});

afterEach(async () => {
  await sql`drop trigger if exists dbtest_slow_seed on cost_items`;
  await sql`drop function if exists dbtest_slow_seed()`;
});

afterAll(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  await sql.end();
});

/** `npm run market:seed-price-books -- --org A --org B`, as its own process: its exit code and everything it printed. */
function runCli(): { exited: Promise<number | null>; output: () => string } {
  const child = spawn(process.execPath, ['--import=tsx', 'src/cli.ts', 'seed-price-books', '--org', ORG_A_ID, '--org', ORG_B_ID], {
    cwd: PACKAGE_DIRECTORY,
    env: { ...process.env, MARKET_DATABASE_URL: process.env.DATABASE_URL },
  });
  let printed = '';
  child.stdout.on('data', (chunk) => void (printed += chunk));
  child.stderr.on('data', (chunk) => void (printed += chunk));
  return { exited: new Promise((resolve) => child.on('exit', resolve)), output: () => printed };
}

/** Ends the CLI's backend once it sits in a studio's write (the trigger's sleep); false if it never got there. */
async function terminateTheWrite(): Promise<boolean> {
  for (let waited = 0; waited < FIND_THE_WRITE_WITHIN_MS; waited += POLL_MS) {
    const [writing] = await sql<Array<{ pid: number }>>`
      select pid from pg_stat_activity where application_name = ${CLI_APPLICATION_NAME} and wait_event = 'PgSleep'`;
    if (writing) return (await sql`select pg_terminate_backend(${writing.pid}) as ended`)[0].ended as boolean;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return false;
}

describe('a connection lost mid-studio', () => {
  it('stops the run at that studio with the per-studio report, the totals and exit 1, and writes nothing for it', async () => {
    const cli = runCli();
    expect(await terminateTheWrite()).toBe(true);
    expect(await cli.exited).toBe(1);
    const lines = cli.output().split(/\r?\n/);
    const lost = lines.findIndex((line) => line.startsWith('  CONNECTION LOST on this studio, the run stopped here: '));
    expect(lost, cli.output()).toBeGreaterThan(0);
    expect(lines[lost - 1]).toMatch(/^studio "/);
    expect(lines).toContain('  not reached: the run stopped before this studio');
    expect(lines.find((line) => line.startsWith('totals: '))).toMatch(/studios failed 1$/);
    expect(lines.some((line) => line.startsWith('STOPPED: the connection to the database was lost during this run.'))).toBe(true);
    expect(cli.output()).not.toMatch(/TypeError|FAILED:/);
    expect(await seededIn(ORG_A_ID)).toEqual([]);
    expect(await seededIn(ORG_B_ID)).toEqual([]);
  });
});
