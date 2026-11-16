// TEST-ONLY. The generated half of a builder characterization: the cases a grid
// is made of (one factor at a time, seeded random picks) and the digest each
// case's output is compared by. A characterization commits one digest per case
// id beside two or three whole outputs a human can read; this module only
// builds the cases, hashes text and reads a golden file. It writes nothing.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The values each input may take. The FIRST value of every pool is the base. */
export type Pools = Record<string, readonly unknown[]>;

/** One value from every pool. */
export type ChoiceOf<P extends Pools> = { [K in keyof P]: P[K][number] };

export interface Case<P extends Pools> {
  id: string;
  choice: ChoiceOf<P>;
}

/** A deterministic picker (mulberry32): the same picks for the same seed on every runtime. */
export function seededPicker(seed: number): <T>(pool: readonly T[]) => T {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return (pool) => pool[Math.floor(next() * pool.length)];
}

/** The first value of every pool. */
export function baseOf<P extends Pools>(pools: P): ChoiceOf<P> {
  return Object.fromEntries(Object.entries(pools).map(([key, pool]) => [key, pool[0]])) as ChoiceOf<P>;
}

/** `ofat/base`, then `ofat/<key>/<i>` for every other value i >= 1 of every pool, in key order: the base with that one value replaced. */
export function oneFactorAtATime<P extends Pools>(pools: P): Case<P>[] {
  const base = baseOf(pools);
  const replaced = Object.entries(pools).flatMap(([key, pool]) =>
    pool.slice(1).map((value, index) => ({
      id: `ofat/${key}/${index + 1}`,
      choice: { ...base, [key]: value } as ChoiceOf<P>,
    })),
  );
  return [{ id: 'ofat/base', choice: base }, ...replaced];
}

/** `rand/<n>` for n in 0..count-1: every key, in key order, picked from its pool by ONE seededPicker(seed). */
export function randomCases<P extends Pools>(pools: P, seed: number, count: number): Case<P>[] {
  const pick = seededPicker(seed);
  return Array.from({ length: count }, (_unused, n) => ({
    id: `rand/${n}`,
    choice: Object.fromEntries(Object.entries(pools).map(([key, pool]) => [key, pick(pool)])) as ChoiceOf<P>,
  }));
}

/** The first 16 hex characters of the SHA-256 of `text` as UTF-8. */
export function digestOf(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

/** A golden file as text, CRLF read as LF: a Windows checkout (core.autocrlf) hands it back with CRLF. */
export function readGolden(url: URL): string {
  return readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
}
