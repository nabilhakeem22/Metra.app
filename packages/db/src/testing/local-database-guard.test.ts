import { describe, expect, it } from 'vitest';
import {
  ALLOW_SHARED_DB_ENV,
  databaseHostFrom,
  isLocalDatabaseHost,
  isSharedDatabaseAllowed,
  localDatabaseGuardFailure,
} from './local-database-guard';

const LOCAL = 'postgresql://postgres:postgres@localhost:5432/postgres';
// The shape of the real thing in the repo-root .env — the reason this exists.
const SHARED =
  'postgresql://postgres.abcdef:pw@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

function failureFor(
  databaseUrl: string | undefined,
  allowShared?: string,
): string | null {
  return localDatabaseGuardFailure({
    databaseUrl,
    allowShared,
    command: 'npm run test:actions -w @metra/web',
    damage: 'creates and deletes organisations',
  });
}

describe('databaseHostFrom', () => {
  it('reads the host out of a Postgres connection string', () => {
    expect(databaseHostFrom(LOCAL)).toBe('localhost');
    expect(databaseHostFrom(SHARED)).toBe('aws-1-eu-west-1.pooler.supabase.com');
  });

  it('splits userinfo at the LAST @, so an @ in the password is not a host', () => {
    expect(databaseHostFrom('postgresql://user:p@ss@localhost:5432/db')).toBe(
      'localhost',
    );
  });

  it('unwraps a bracketed IPv6 host', () => {
    expect(databaseHostFrom('postgresql://u:p@[::1]:5432/db')).toBe('::1');
  });

  it('returns null for anything it cannot parse', () => {
    for (const value of ['', 'not a url', 'postgres@@@', '   ']) {
      expect(databaseHostFrom(value)).toBeNull();
    }
  });
});

describe('isLocalDatabaseHost', () => {
  it('accepts the loopback spellings', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '0.0.0.0', 'LOCALHOST']) {
      expect(isLocalDatabaseHost(host)).toBe(true);
    }
  });

  it('is an EXACT match, never a suffix one', () => {
    // Every one of these is a resolvable public host.
    for (const host of [
      'localhost.attacker.example',
      'notlocalhost',
      'my-localhost.com',
      '127.0.0.1.attacker.example',
    ]) {
      expect(isLocalDatabaseHost(host)).toBe(false);
    }
  });
});

describe('isSharedDatabaseAllowed', () => {
  it('accepts only the documented truthy spellings', () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ']) {
      expect(isSharedDatabaseAllowed(value)).toBe(true);
    }
    for (const value of [undefined, '', '0', 'false', 'no', 'maybe']) {
      expect(isSharedDatabaseAllowed(value)).toBe(false);
    }
  });
});

describe('localDatabaseGuardFailure', () => {
  it('lets a local database through', () => {
    expect(failureFor(LOCAL)).toBeNull();
    expect(failureFor('postgresql://u:p@127.0.0.1:5432/db')).toBeNull();
  });

  it('REFUSES the shared Supabase host and names it', () => {
    const failure = failureFor(SHARED);
    expect(failure).toContain('aws-1-eu-west-1.pooler.supabase.com');
    expect(failure).toContain('npm run test:actions -w @metra/web');
    expect(failure).toContain('creates and deletes organisations');
    expect(failure).toContain(ALLOW_SHARED_DB_ENV);
  });

  it('refuses a missing or blank DATABASE_URL rather than assuming safety', () => {
    expect(failureFor(undefined)).toContain('DATABASE_URL is not set');
    expect(failureFor('   ')).toContain('DATABASE_URL is not set');
  });

  it('refuses a URL it cannot parse, because it cannot be proven local', () => {
    expect(failureFor('not a url')).toContain('could not be parsed');
  });

  it('honours the explicit opt-out, including on an unparseable URL', () => {
    expect(failureFor(SHARED, '1')).toBeNull();
    expect(failureFor('not a url', 'yes')).toBeNull();
  });

  it('does NOT honour a falsey opt-out', () => {
    expect(failureFor(SHARED, '0')).not.toBeNull();
    expect(failureFor(SHARED, 'false')).not.toBeNull();
  });
});
