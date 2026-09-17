import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PostgresJs } from '../client';
import { MIGRATION_LOCK_TIMEOUT, applyLockTimeout, applyRlsTimeouts } from './lock-timeout';

// R4: `apply-rls` had a verified `lock_timeout` and NO client-side deadline, so
// after a successful connect a stalled socket left `sql.unsafe` waiting forever
// - an operator staring at `Applying policies/10-…` with no error. These cases
// pin the pair and, more importantly, the read-back: an unverified belt that
// silently did nothing is worse than none.
//
// THE TRAP THEY GUARD is that Postgres REFORMATS a GUC. `set_config(…, '60s')`
// reads back through `current_setting` as `'1min'`, so a text comparison would
// throw on a value that stuck perfectly. The check reads `pg_settings.setting`,
// which is always the base unit as a plain number.

interface Recorded {
  setCalls: Array<[string, string]>;
}

/** A postgres.js stand-in that records set_config and answers pg_settings. */
function fixtureSql(applied: Record<string, string>, recorded: Recorded): PostgresJs {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('set_config')) {
      recorded.setCalls.push([String(values[0]), String(values[1])]);
      return Promise.resolve([{ set_config: values[1] }]);
    }
    const names = values[0] as string[];
    return Promise.resolve(
      names
        .filter((name) => name in applied)
        .map((name) => ({ name, setting: applied[name] })),
    );
  };
  return sql as unknown as PostgresJs;
}

afterEach(() => {
  vi.restoreAllMocks();
});

function silenceLog() {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
}

describe('applyLockTimeout', () => {
  it('sets lock_timeout only, and accepts the 3000 ms Postgres stores', async () => {
    silenceLog();
    const recorded: Recorded = { setCalls: [] };
    await applyLockTimeout(fixtureSql({ lock_timeout: '3000' }, recorded));
    expect(recorded.setCalls).toEqual([['lock_timeout', '3s']]);
    expect(MIGRATION_LOCK_TIMEOUT).toBe('3s');
  });

  it('throws when the pooler ate the setting', async () => {
    // The measured Supavisor behaviour: the startup parameter is discarded and
    // lock_timeout is still 0. Refusing to run DDL unbounded is the whole point.
    const recorded: Recorded = { setCalls: [] };
    await expect(applyLockTimeout(fixtureSql({ lock_timeout: '0' }, recorded))).rejects.toThrow(
      /lock_timeout is 0ms after set_config, expected 3000ms \(3s\)/,
    );
  });

  it('throws when the setting cannot be read back at all', async () => {
    const recorded: Recorded = { setCalls: [] };
    await expect(applyLockTimeout(fixtureSql({}, recorded))).rejects.toThrow(/unreadable/);
  });
});

describe('applyRlsTimeouts', () => {
  it('sets BOTH, and verifies 60s as 60000 ms rather than as text', async () => {
    // `current_setting('statement_timeout')` would answer '1min' here. Comparing
    // that against '60s' would fail on a value that stuck - which is why the
    // read-back uses pg_settings.
    silenceLog();
    const recorded: Recorded = { setCalls: [] };
    await applyRlsTimeouts(
      fixtureSql({ lock_timeout: '3000', statement_timeout: '60000' }, recorded),
    );
    expect(recorded.setCalls).toEqual([
      ['lock_timeout', '3s'],
      ['statement_timeout', '60s'],
    ]);
  });

  it('refuses when statement_timeout did not stick, even though lock_timeout did', async () => {
    const recorded: Recorded = { setCalls: [] };
    await expect(
      applyRlsTimeouts(fixtureSql({ lock_timeout: '3000', statement_timeout: '0' }, recorded)),
    ).rejects.toThrow(/statement_timeout is 0ms after set_config, expected 60000ms \(60s\)/);
  });

  it('logs both values on the happy path, so a green run says what is in force', async () => {
    const lines: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    await applyRlsTimeouts(
      fixtureSql({ lock_timeout: '3000', statement_timeout: '60000' }, { setCalls: [] }),
    );
    expect(lines).toEqual([
      'lock_timeout = 3s, statement_timeout = 60s (read back from pg_settings on this session)',
    ]);
  });
});
