/**
 * PASS 2 of assert-no-baked-secrets.mjs: the secret-shaped VALUES in a build
 * output tree, a service-role JWT, a Resend key, a Supabase secret key or a
 * Postgres URL with a password, however they got there. The key pass and the
 * value pass are two jobs, so this one has its own module; the script that
 * runs both is beside it.
 *
 * Nothing here returns or prints a VALUE: only the kind of secret and the path
 * of the file that holds it.
 */
import { Buffer } from 'node:buffer';
import { closeSync, openSync, readdirSync, readSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

/** Value shapes that cannot belong to a public var, whatever they are named. */
const VALUE_PATTERNS = [
  { what: 'a Resend API key', pattern: /\bre_[A-Za-z0-9]{16,}/ },
  {
    what: 'a Postgres URL carrying a password',
    pattern: /postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@/,
  },
  // The new-format Supabase SECRET key. Its public twin, `sb_publishable_`,
  // belongs in the bundle and is not matched.
  { what: 'a Supabase secret key', pattern: /\bsb_secret_[A-Za-z0-9_-]{20,}/ },
];

/**
 * Does this text hold a SERVICE-ROLE JWT?
 *
 * The anon key is a JWT too and belongs in the bundle, so `eyJ…` on its own
 * proves nothing. The two are told apart by the JWT's own payload: decode the
 * middle segment and look for the role claim. Nothing decoded is ever printed.
 */
function hasServiceRoleJwt(text) {
  const jwt = /eyJ[A-Za-z0-9_-]{20,}\.(eyJ[A-Za-z0-9_-]{20,})\.[A-Za-z0-9_-]+/g;
  for (const [, payload] of text.matchAll(jwt)) {
    try {
      if (Buffer.from(payload, 'base64url').toString('utf8').includes('service_role')) {
        return true;
      }
    } catch {
      // An `eyJ…` run that is not base64url is not a JWT. Not our business.
    }
  }
  return false;
}

/** The kind of secret this text holds, or null. */
function secretKindIn(text) {
  return (
    VALUE_PATTERNS.find(({ pattern }) => pattern.test(text))?.what ??
    (hasServiceRoleJwt(text) ? 'a service-role JWT' : null)
  );
}

/**
 * Where a baked value can actually be: compiled modules and their data.
 *
 * NOT documentation. `node_modules/postgres/README.md` ships inside the bundle
 * and its usage example is `postgres://username:password@host:port/database` —
 * a shape-only scan cannot tell that from a real DSN, and failing a deploy over
 * a library's README is the kind of false alarm that gets a check deleted.
 */
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.json', '.html']);

/** Every file under `dir`, depth first. */
function* filesUnder(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* filesUnder(path);
    else if (entry.isFile()) yield path;
  }
}

/**
 * A file is read this much at a time, whatever its size. No file is skipped for
 * being large: the server handler bundle is the likeliest home of an inlined
 * literal, and it is also the largest module in the tree.
 */
export const SCAN_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * The tail of each chunk is scanned again in front of the next, so a value
 * that sits across a chunk boundary is still seen whole. Far longer than any
 * secret looked for here (a service-role JWT is a few hundred characters).
 */
export const SCAN_OVERLAP_BYTES = 64 * 1024;

/**
 * The one window every file is read through: the carried tail, then a chunk.
 * Allocated once for the run. Only the bytes just written are ever read back,
 * so nothing of one file is scanned as part of the next.
 */
const scanWindow = Buffer.alloc(SCAN_OVERLAP_BYTES + SCAN_CHUNK_BYTES);

/** The kind of secret the file at `path` holds, or null. */
function secretKindInFile(path) {
  const file = openSync(path, 'r');
  try {
    let carried = 0;
    for (;;) {
      const read = readSync(file, scanWindow, carried, SCAN_CHUNK_BYTES, null);
      if (read === 0) return null;
      const scanned = carried + read;
      // latin1 maps one byte to one character, so a chunk cut inside a
      // multi-byte character cannot hide or invent an ASCII secret.
      const kind = secretKindIn(scanWindow.toString('latin1', 0, scanned));
      if (kind) return kind;
      carried = Math.min(SCAN_OVERLAP_BYTES, scanned);
      scanWindow.copy(scanWindow, 0, scanned - carried, scanned);
    }
  } finally {
    closeSync(file);
  }
}

/** One line per file under `bundleDir` whose CONTENT looks like a secret: its path and the kind, never the value. */
export function filesHoldingSecrets(bundleDir) {
  const hits = [];
  for (const path of filesUnder(bundleDir)) {
    if (!SCANNED_EXTENSIONS.has(extname(path))) continue;
    const kind = secretKindInFile(path);
    if (kind) hits.push(`  - ${relative(bundleDir, path)} (${kind})`);
  }
  return hits;
}
