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

/** Set to 1/true/yes to run a DB suite against the shared database anyway. */
export const ALLOW_SHARED_DB_ENV = 'METRA_ALLOW_SHARED_DB';

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

const SETUP_HELP = [
  'Point it at a local Postgres:',
  '',
  '  docker run --name metra-test-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:17',
  '  export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres',
  '  npm run db:migrate && npm run db:apply-rls && npm run db:seed',
  '',
  'Full setup, and the opt-out, are documented in docs/DEPLOY.md.',
].join('\n');

function optOutHelp(host: string): string {
  return [
    `If you really do mean to run against ${host}, and you accept that it will`,
    `delete data there, set ${ALLOW_SHARED_DB_ENV}=1.`,
  ].join('\n');
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
    return [
      `Refusing to run \`${command}\`: DATABASE_URL is not set.`,
      `This suite ${damage}, so it needs its own local Postgres.`,
      '',
      SETUP_HELP,
    ].join('\n');
  }

  const host = databaseHostFrom(databaseUrl);
  // A provably local host always runs; an explicit opt-out always runs.
  // Everything else, INCLUDING a URL we could not parse, is refused.
  if (host !== null && isLocalDatabaseHost(host)) return null;
  if (isSharedDatabaseAllowed(allowShared)) return null;

  if (host === null) {
    return [
      `Refusing to run \`${command}\`: DATABASE_URL could not be parsed, so it`,
      'cannot be proven to point at a local database.',
      `This suite ${damage}. Rather than guess, it stops here.`,
      '',
      SETUP_HELP,
      '',
      optOutHelp('that connection string'),
    ].join('\n');
  }

  return [
    `Refusing to run \`${command}\` against a non-local database.`,
    '',
    `  DATABASE_URL host: ${host}`,
    '',
    `This suite ${damage}. The repo-root .env holds the HOSTED Supabase`,
    'connection string, so running this suite as-is would do that to the shared',
    'database every environment reads.',
    '',
    SETUP_HELP,
    '',
    optOutHelp(host),
  ].join('\n');
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
