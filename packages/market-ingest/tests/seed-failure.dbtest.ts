import { ORG_A_ID, ORG_B_ID, USER_A_ID } from '@metra/db';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedCommand } from '../src/commands/seed-command';
import { CLI_APPLICATION_NAME } from '../src/db/connection';
import { clearMarketTestData, openTestDatabase } from './db-fixture';
import { clearSeeded, publishFixture, seededIn, sql } from './seed-fixture';

// A studio that fails prints the database's reason and SQLSTATE, never the
// query or its parameters (fix round F1), and the other studios are seeded.

let printed: string[] = [];

beforeEach(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  await publishFixture();
  printed = [];
  vi.spyOn(console, 'log').mockImplementation((line: string) => void printed.push(line));
});

afterEach(async () => {
  await sql`drop trigger if exists dbtest_refuse_seed on cost_items`;
  await sql`drop function if exists dbtest_refuse_seed()`;
  await sql`drop trigger if exists dbtest_slow_seed on cost_items`;
  await sql`drop function if exists dbtest_slow_seed()`;
});

afterAll(async () => {
  await clearSeeded();
  await clearMarketTestData(sql);
  await sql.end();
});

function failedLine(): string {
  const line = printed.find((candidate) => candidate.includes('FAILED, nothing written for this studio')) ?? '';
  expect(line).not.toMatch(/insert into|params:|MKT-|\d{3,}\.\d{4}/);
  expect(line.length).toBeLessThan(400);
  return line;
}

describe('a studio that fails', () => {
  it('names a raising trigger by its message and SQLSTATE', async () => {
    await sql.unsafe(`create function dbtest_refuse_seed() returns trigger language plpgsql as $$
      begin
        if new.org_id = '${ORG_A_ID}' and new.code like 'MKT-%' then raise exception 'dbtest: studio A refuses seeded items'; end if;
        return new;
      end $$`);
    await sql.unsafe('create trigger dbtest_refuse_seed before insert on cost_items for each row execute function dbtest_refuse_seed()');
    expect(await seedCommand(['--org', ORG_A_ID, '--org', ORG_B_ID])).toBe(1);
    expect(failedLine()).toContain('SQLSTATE P0001: dbtest: studio A refuses seeded items');
    expect(await seededIn(ORG_A_ID)).toEqual([]);
    expect(await seededIn(ORG_B_ID)).toHaveLength(3);
  });

  it('names a lock timeout behind a studio write still open on the same code', async () => {
    const studio = openTestDatabase();
    let release!: () => void;
    const held = studio.begin(async (tx) => {
      await tx`select set_config('app.current_org_id', ${ORG_A_ID}, true), set_config('app.current_user_id', ${USER_A_ID}, true)`;
      await tx.unsafe('set local role metra_app');
      const [section] = await tx`select id from sections limit 1`;
      await tx`insert into cost_items (org_id, code, name_en, section_id, unit) values (${ORG_A_ID}, 'MKT-raw.steel.dbtest_rebar', 'typed by the studio', ${section.id}, 'ton')`;
      await new Promise<void>((resolve) => { release = resolve; });
      throw new Error('rolled back on purpose');
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await seedCommand(['--org', ORG_A_ID, '--org', ORG_B_ID])).toBe(1);
    expect(failedLine()).toContain('SQLSTATE 55P03: canceling statement due to lock timeout');
    release();
    await held;
    await studio.end();
    expect(await seededIn(ORG_B_ID)).toHaveLength(3);
  });
});

// Overnight round, R3: the CLI's backend terminated while it wrote a studio
// (a dropped link ends the same way) aborted the whole run with one line, no
// per-studio report and no totals, so the owner could not see what committed.
describe('a connection lost mid-studio', () => {
  it('stops the run at that studio with the per-studio report, the totals and exit 1, and writes nothing for it', async () => {
    await sql.unsafe(`create function dbtest_slow_seed() returns trigger language plpgsql as $$
      begin perform pg_sleep(10); return null; end $$`);
    await sql.unsafe('create trigger dbtest_slow_seed before insert on cost_items for each statement execute function dbtest_slow_seed()');
    const running = seedCommand(['--org', ORG_A_ID, '--org', ORG_B_ID]);
    // End the CLI's backend while it sits in the first studio's write.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [writing] = await sql<Array<{ pid: number }>>`
        select pid from pg_stat_activity where application_name = ${CLI_APPLICATION_NAME} and wait_event = 'PgSleep'`;
      if (writing) {
        await sql`select pg_terminate_backend(${writing.pid})`;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(await running).toBe(1);
    const lost = printed.findIndex((line) => line.startsWith('  CONNECTION LOST on this studio, the run stopped here: SQLSTATE '));
    expect(lost).toBeGreaterThan(0);
    expect(printed[lost - 1]).toMatch(/^studio "/);
    expect(printed).toContain('  not reached: the run stopped before this studio');
    expect(printed.find((line) => line.startsWith('totals: '))).toMatch(/studios failed 1$/);
    expect(printed.at(-1)).toMatch(/^STOPPED: the connection to the database was lost during this run\. Run the same command again/);
    expect(await seededIn(ORG_A_ID)).toEqual([]);
    expect(await seededIn(ORG_B_ID)).toEqual([]);
  });
});
