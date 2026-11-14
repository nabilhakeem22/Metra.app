import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { closeExecutionFixture, ownerQuery, sqlstate } from './execution-fixture';
import { failuresOf, freshHash, pauseSeconds, record, removePlanted } from './sign-in-failures-fixture';

// Security batch 3, P2 (migration 0067, rls/functions/90-sign-in.sql): wrong
// sign-in codes counted per identifier hash, and the pause the tenth one starts.
// Who may reach the table and the functions is sign-in-failures-access.dbtest.ts.

afterEach(removePlanted);

afterAll(async () => {
  await closeExecutionFixture();
});

/** Rows whose window started `hoursAgo` hours back, each one second older than the next. */
async function plantStale(hashes: string[], hoursAgo: number): Promise<void> {
  await ownerQuery(
    `insert into public.sign_in_failures (identifier_hash, window_started_at, failures)
     select t.hash, now() - make_interval(hours => $2::int, secs => t.position), 3
       from unnest($1::text[]) with ordinality as t(hash, position)`,
    [hashes, hoursAgo],
  );
}

async function howManyRemain(hashes: string[]): Promise<number> {
  const [row] = await ownerQuery<{ n: number }>(`select count(*)::int as n from public.sign_in_failures where identifier_hash = any($1::text[])`, [hashes]);
  return row.n;
}

describe('the tenth wrong code in one window pauses the identifier (AC12)', () => {
  it('answers null for nine wrong codes, then the seconds left, and the pre-check agrees', async () => {
    const hash = freshHash();
    for (let attempt = 1; attempt <= 9; attempt += 1) expect(await record(hash), `wrong code ${String(attempt)}`).toBeNull();
    expect(await pauseSeconds(hash)).toBeNull();

    const tenth = await record(hash);
    expect(tenth).toBeGreaterThanOrEqual(1);
    expect(tenth).toBeLessThanOrEqual(3600);
    const paused = await pauseSeconds(hash);
    expect(paused).toBeGreaterThanOrEqual(1);
    expect(paused).toBeLessThanOrEqual(3600);
    expect(await pauseSeconds(freshHash()), 'another identifier is not paused').toBeNull();
  });

  it('keeps counting past ten inside the window, and never past 100', async () => {
    const hash = freshHash();
    await ownerQuery(`insert into public.sign_in_failures (identifier_hash, failures) values ($1, 99)`, [hash]);
    expect(await record(hash)).toBeGreaterThanOrEqual(1);
    expect(await record(hash)).toBeGreaterThanOrEqual(1);
    expect(await failuresOf(hash)).toBe(100);
  });
});

describe('the window is one fixed hour (AC13)', () => {
  it('a pause whose window started 61 minutes ago is over, and the next wrong code starts a new window at 1', async () => {
    const hash = freshHash();
    await ownerQuery(
      `insert into public.sign_in_failures (identifier_hash, window_started_at, failures) values ($1, now() - interval '61 minutes', 10)`,
      [hash],
    );
    expect(await pauseSeconds(hash)).toBeNull();
    expect(await record(hash)).toBeNull();
    const [row] = await ownerQuery<{ failures: number; fresh: boolean }>(
      `select failures, window_started_at > now() - interval '1 minute' as fresh from public.sign_in_failures where identifier_hash = $1`,
      [hash],
    );
    expect(row).toEqual({ failures: 1, fresh: true });
  });

  it('a pause whose window started 59 minutes ago still holds', async () => {
    const hash = freshHash();
    await ownerQuery(
      `insert into public.sign_in_failures (identifier_hash, window_started_at, failures) values ($1, now() - interval '59 minutes', 10)`,
      [hash],
    );
    const left = await pauseSeconds(hash);
    expect(left).toBeGreaterThanOrEqual(1);
    expect(left).toBeLessThanOrEqual(60);
  });
});

describe('a record removes at most 50 stale rows of other identifiers (AC14)', () => {
  it('removes the 50 oldest of 60, keeps a live row, and resets the caller own stale row instead of spending the 50 on it', async () => {
    const caller = freshHash();
    const stale = Array.from({ length: 60 }, freshHash);
    const live = freshHash();
    await plantStale([caller], 9);
    await plantStale(stale, 3);
    await ownerQuery(`insert into public.sign_in_failures (identifier_hash, failures) values ($1, 4)`, [live]);

    expect(await record(caller)).toBeNull();
    expect(await howManyRemain(stale)).toBe(10);
    expect(await howManyRemain(stale.slice(0, 10)), 'the ten newest stale rows are the ones left').toBe(10);
    expect(await failuresOf(caller)).toBe(1);
    expect(await failuresOf(live)).toBe(4);

    expect(await record(caller)).toBeNull();
    expect(await howManyRemain(stale)).toBe(0);
    expect(await failuresOf(caller)).toBe(2);
  });
});

describe('a malformed hash is refused before anything is written (AC15)', () => {
  it('raises 22023 for null, upper case, a short, a long and a padded hash, and plants no row', async () => {
    const good = randomBytes(32).toString('hex');
    const malformed = [null, good.toUpperCase(), good.slice(1), `${good}0`, `${good}\n`, ` ${good}`, ''];
    const [before] = await ownerQuery<{ n: number }>(`select count(*)::int as n from public.sign_in_failures`);
    for (const hash of malformed) expect(await sqlstate(record(hash)), JSON.stringify(hash)).toBe('22023');
    const [after] = await ownerQuery<{ n: number }>(`select count(*)::int as n from public.sign_in_failures`);
    expect(after.n).toBe(before.n);
    expect(await pauseSeconds(good.toUpperCase()), 'the read answers not paused, it never raises').toBeNull();
  });
});
