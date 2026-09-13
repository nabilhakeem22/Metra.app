// The REFUSAL TEXT of the local-database guard, and nothing else. Split out of
// local-database-guard.ts so the guard file is a decision and this one is a
// message: what counts as local is a rule, how it is explained is prose, and the
// prose is the larger half. Every function here is pure and takes only what it
// prints, so the guard imports messages and nothing imports back.

/** Set to 1/true/yes to run a DB suite against the shared database anyway. */
export const ALLOW_SHARED_DB_ENV = 'METRA_ALLOW_SHARED_DB';

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

/** DATABASE_URL is absent: there is no database to prove anything about. */
export function missingUrlRefusal(command: string, damage: string): string {
  return [
    `Refusing to run \`${command}\`: DATABASE_URL is not set.`,
    `This suite ${damage}, so it needs its own local Postgres.`,
    '',
    SETUP_HELP,
  ].join('\n');
}

/** DATABASE_URL is present but unparsable: refused rather than guessed at. */
export function unparsableUrlRefusal(command: string, damage: string): string {
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

/** DATABASE_URL parses and names a host that is not loopback. */
export function nonLocalHostRefusal(
  command: string,
  damage: string,
  host: string,
): string {
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
