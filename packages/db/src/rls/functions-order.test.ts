import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RLS_APPLY_ORDER } from './manifest';

// apply-rls runs the functions/* files in RLS_APPLY_ORDER, and PostgreSQL
// validates a `language sql` function body at CREATE time (check_function_bodies is
// on by default). So a `language sql` function that calls another `public.app_*`
// function defined LATER IN THAT SEQUENCE fails to create — with a confusing
// "function ... does not exist" naming the CALLEE, not the caller, and reported
// against whichever file apply-rls was on.
//
// That is invisible to tsc, to lint and to every unit test: it only shows up when a
// real database replays the files, which locally is never. This test makes it a
// LOCAL failure by reading the same files, in the same order, and checking
// definition order across the whole sequence.
//
// SCOPE, deliberately narrow: only `language sql` bodies. A `language plpgsql` body
// is NOT parsed at creation — its calls resolve at runtime — so a forward reference
// there is legal and several already exist. Widening this test to plpgsql would
// flag working code.

const here = dirname(fileURLToPath(import.meta.url));
const rlsDir = here;
// The manifest, not a filename: apply-rls concatenates these in this order, so
// this is the order Postgres sees. Reading it here also makes the test STRONGER
// than it could be against one file - it now catches a `language sql` function
// that calls a helper defined in a LATER file, a forward reference across files
// that no test could see before.
const functionFiles = RLS_APPLY_ORDER.filter((file) => file.startsWith('functions/'));
const source = functionFiles
  .map((file) => readFileSync(resolve(here, file), 'utf8'))
  .join('\n');

/** Strip `--` line comments and `drop function ...;` statements, so a name that
 *  merely APPEARS in prose or in a drop is never mistaken for a call. */
function scannable(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/drop\s+function[^;]*;/gi, '');
}

interface FunctionBlock {
  name: string;
  language: string;
  start: number;
  body: string;
}

/** Split the file into `create or replace function` blocks, in file order. */
function functionBlocks(sql: string): FunctionBlock[] {
  const define = /create\s+or\s+replace\s+function\s+public\.(app_\w+)\s*\(/gi;
  const starts = [...sql.matchAll(define)].map((m) => ({
    name: m[1].toLowerCase(),
    start: m.index,
  }));
  return starts.map((entry, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].start : sql.length;
    const body = sql.slice(entry.start, end);
    const language = /\blanguage\s+(\w+)/i.exec(body)?.[1]?.toLowerCase() ?? '';
    return { ...entry, language, body };
  });
}

describe('rls/manifest.ts covers every .sql file under rls/', () => {
  // The same silent-omission shape as journal defect D7: a .sql file with no
  // manifest entry is NEVER APPLIED, with no error and no log line, and the
  // symptom turns up somewhere else entirely (D7 surfaced as apply-rls failing
  // to create a function whose column did not exist). A manifest entry with no
  // file is the mirror image: apply-rls throws ENOENT halfway through a run.
  const onDisk = readdirSync(rlsDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => {
      const absolute = resolve(entry.parentPath ?? entry.path, entry.name);
      // Manifest entries are written with forward slashes on every platform.
      return relative(rlsDir, absolute).split(sep).join('/');
    })
    .sort();

  it('lists every .sql file on disk exactly once', () => {
    expect([...RLS_APPLY_ORDER].sort()).toEqual(onDisk);
  });

  it('lists nothing that is not on disk', () => {
    for (const file of RLS_APPLY_ORDER) {
      expect(existsSync(resolve(rlsDir, file)), `${file} is in RLS_APPLY_ORDER but not on disk`).toBe(
        true,
      );
    }
  });
});

describe('rls/functions/* definition order', () => {
  const clean = scannable(source);
  const blocks = functionBlocks(clean);
  const definedAt = new Map<string, number>();
  for (const block of blocks) {
    if (!definedAt.has(block.name)) definedAt.set(block.name, block.start);
  }

  it('finds the app_* functions it is meant to be checking', () => {
    // A guard on the guard: if the CREATE spelling ever changes, this test would
    // otherwise pass by silently checking nothing.
    expect(blocks.length).toBeGreaterThan(15);
    expect(definedAt.has('app_delivery_by_token')).toBe(true);
    expect(blocks.some((b) => b.language === 'sql')).toBe(true);
  });

  it('defines every app_* helper BEFORE the `language sql` function that calls it', () => {
    const violations: string[] = [];
    for (const block of blocks) {
      if (block.language !== 'sql') continue;
      for (const match of block.body.matchAll(/public\.(app_\w+)\s*\(/gi)) {
        const callee = match[1].toLowerCase();
        if (callee === block.name) continue; // its own CREATE line
        const calleeStart = definedAt.get(callee);
        if (calleeStart === undefined) continue; // not defined in this file
        if (calleeStart > block.start) {
          violations.push(
            `${block.name} (language sql) calls public.${callee}, which is defined LATER in the RLS_APPLY_ORDER concatenation of rls/functions/*`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
