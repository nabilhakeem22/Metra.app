// Refuses to let a destructive DB suite run against anything but a local
// Postgres.
//
// WHY THIS EXISTS. Both DB suites resolve DATABASE_URL by loading the repo-root
// `.env` (vitest.actions.config.ts / vitest.isolation.config.ts), and that file
// holds the developer's HOSTED Supabase connection string — the one the README
// tells you to put there. So the obvious pre-push command,
// `npm run test:actions -w @metra/web`, ran seedOrg()/teardown() against the
// shared database. The evidence is in it: 480 organisations named 'Test Org'
// against 7 real ones, left behind by runs that were interrupted before their
// teardown could fire. The isolation suite goes further and drops scratch tables
// in `public`.
//
// CI is unaffected: it exports DATABASE_URL pointing at its own postgres:17
// service container, and dotenv does not override an already-set variable, so
// the guard sees localhost and passes.
//
// FAIL CLOSED. A URL that cannot be parsed, or one that is missing, is refused
// rather than assumed safe. Proving a host is local is the only thing that lets
// a suite run; the documented opt-out is the only other way through.

import {
  ALLOW_SHARED_DB_ENV,
  missingUrlRefusal,
  nonLocalHostRefusal,
  unparsableUrlRefusal,
} from './local-database-guard-message';

// Re-exported so this file stays the single import surface for the guard.
export { ALLOW_SHARED_DB_ENV };

// EXACT hosts only, never a suffix match: `localhost.attacker.example` is a
// perfectly resolvable public host and must not read as local.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

const TRUTHY = new Set(['1', 'true', 'yes']);

/** Whether an explicit opt-out value enables running against the shared DB. */
export function isSharedDatabaseAllowed(value: string | undefined): boolean {
  return value !== undefined && TRUTHY.has(value.trim().toLowerCase());
}

/** Is this exact hostname a loopback/local address? */
export function isLocalDatabaseHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim().toLowerCase());
}

/**
 * The hostname in a Postgres connection string, or null if it cannot be parsed.
 * WHATWG `URL` splits userinfo at the LAST `@`, so a password containing `@`
 * still yields the right host. Anything it cannot parse returns null, which is
 * refused.
 */
export function databaseHostFrom(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // IPv6 hostnames come back bracketed (`[::1]`); compare the address itself.
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  return host === '' ? null : host;
}

export interface LocalDatabaseGuardInput {
  /** The resolved connection string, after .env loading. */
  databaseUrl: string | undefined;
  /** Raw value of the opt-out env var. */
  allowShared: string | undefined;
  /** How the developer invoked this suite. */
  command: string;
  /** One line on what the suite does to the database, for the refusal message. */
  damage: string;
}

/**
 * The refusal message for these inputs, or null when the suite may run. PURE —
 * this is the unit-tested part, so the guard never has to be proven by pointing
 * a real suite at a real shared database.
 */
export function localDatabaseGuardFailure(
  input: LocalDatabaseGuardInput,
): string | null {
  const { databaseUrl, allowShared, command, damage } = input;
  if (databaseUrl === undefined || databaseUrl.trim() === '') {
    return missingUrlRefusal(command, damage);
  }

  const host = databaseHostFrom(databaseUrl);
  // A provably local host always runs; an explicit opt-out always runs.
  // Everything else, INCLUDING a URL we could not parse, is refused.
  if (host !== null && isLocalDatabaseHost(host)) return null;
  if (isSharedDatabaseAllowed(allowShared)) return null;

  return host === null
    ? unparsableUrlRefusal(command, damage)
    : nonLocalHostRefusal(command, damage, host);
}

/**
 * Throws unless the resolved DATABASE_URL points at a local Postgres. Called
 * from the vitest DB configs, so it fails before a single test — and before a
 * single connection — is opened.
 */
export function assertLocalDatabase(input: {
  command: string;
  damage: string;
}): void {
  const failure = localDatabaseGuardFailure({
    databaseUrl: process.env.DATABASE_URL,
    allowShared: process.env[ALLOW_SHARED_DB_ENV],
    command: input.command,
    damage: input.damage,
  });
  if (failure !== null) throw new Error(`\n\n${failure}\n`);
}
