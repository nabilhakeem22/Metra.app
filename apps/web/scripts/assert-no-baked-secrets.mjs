#!/usr/bin/env node
/**
 * Fail the build if a SECRET was inlined into the Cloudflare Worker bundle.
 *
 * OpenNext resolves `process.env.X` from server code at BUILD time and writes
 * what it saw into `.open-next/cloudflare/next-env.mjs`, which ships inside the
 * deployed artifact. For a NEXT_PUBLIC_ var that is exactly the intent. For
 * SUPABASE_SERVICE_ROLE_KEY — a full RLS bypass — it would mean the secret sits
 * in a build output, in any CI log that prints it, and in every deploy, and can
 * only be rotated by rebuilding.
 *
 * lib/cf/secrets.ts exists so that cannot happen. THIS script is what keeps it
 * true: the discipline is invisible to tsc, to lint and to every unit test,
 * because a re-added `process.env.SUPABASE_SERVICE_ROLE_KEY` compiles perfectly
 * and only shows up in the build output nobody reads.
 *
 * Runs immediately after `opennextjs-cloudflare build` in ci.yml and deploy.yml.
 * Never prints a VALUE — only the offending key name.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // apps/web/scripts
const envFile = resolve(here, '../.open-next/cloudflare/next-env.mjs');

/**
 * Keys that are legitimately in the bundle and are not secrets. NODE_ENV and
 * NEXT_RUNTIME are set by the framework itself, not by us. Everything else must
 * be NEXT_PUBLIC_, which is the declaration that a value is meant for a browser.
 */
const ALLOWLIST = new Set(['NODE_ENV', 'NEXT_RUNTIME']);

function readEnvFile() {
  try {
    return readFileSync(envFile, 'utf8');
  } catch (cause) {
    // Loud on purpose. If OpenNext moves or renames this file, the check would
    // otherwise pass silently forever and the guarantee would quietly lapse.
    console.error(
      `assert-no-baked-secrets: cannot read ${envFile}\n` +
        'The OpenNext build layout changed — UPDATE THIS SCRIPT. Do not delete it: ' +
        'a check that cannot find its input must fail, not pass.',
    );
    console.error(String(cause));
    process.exit(1);
  }
}

/** Every key assigned in the emitted env module, in source order. */
function assignedKeys(source) {
  const keys = [];
  // Matches `FOO:`, `"FOO":`, `FOO =` and `process.env.FOO =` alike — the
  // emitted shape has changed across OpenNext versions, so match broadly and let
  // the allowlist do the deciding. The leading `.` in the prefix class is what
  // catches the `process.env.FOO =` form the current version emits; without it
  // this check matches NOTHING and passes every build.
  const pattern = /(?:^|[\s{,;.])["']?([A-Z][A-Z0-9_]*)["']?\s*[:=]/gm;
  for (const match of source.matchAll(pattern)) keys.push(match[1]);
  return [...new Set(keys)];
}

const source = readEnvFile();
const baked = assignedKeys(source).filter(
  (key) => !key.startsWith('NEXT_PUBLIC_') && !ALLOWLIST.has(key),
);

if (baked.length > 0) {
  console.error(
    'assert-no-baked-secrets: non-public value(s) inlined into the Worker bundle:\n' +
      baked.map((key) => `  - ${key}`).join('\n') +
      '\n\nRead it at request time with runtimeSecret() from lib/cf/secrets.ts, or ' +
      'rename it NEXT_PUBLIC_ if it is genuinely meant for the browser.',
  );
  process.exit(1);
}

console.log(
  `assert-no-baked-secrets: OK (${assignedKeys(source).length} key(s), all public or framework).`,
);
