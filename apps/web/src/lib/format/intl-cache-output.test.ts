import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as cachedDate from './date';
import * as cachedMoney from './money';
import * as cachedNumber from './number';
import * as cachedRelative from './relative-time';

// Round E (AC W6): a CACHED formatter prints byte for byte what a fresh one
// does. The reference is the same format modules loaded a second time with
// ./intl-cache swapped for a stand-in that builds a NEW Intl formatter on every
// call (the code before Round E), so only the formatter's origin differs. Zero
// differences allowed.

const LOCALES = ['en', 'ar-EG'] as const;
const SAMPLES = 500;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** mulberry32: a seeded PRNG, so a failure names a value that comes back on the next run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const random = seededRandom(20261012);
const INSTANTS = Array.from({ length: SAMPLES }, () => Date.UTC(1990, 0, 1) + Math.floor(random() * 50 * 365 * DAY));
const AMOUNTS: Array<number | string> = Array.from({ length: SAMPLES }, (_, index) => {
  const magnitude = 10 ** Math.floor(random() * 10);
  const value = (random() - 0.2) * magnitude;
  if (index % 5 === 0) return Math.round(value); // whole: the trimmed branch
  if (index % 5 === 1) return value.toFixed(4); // a NUMERIC(18,4) string
  if (index % 5 === 2) return value.toFixed(2);
  return value;
});

/** Formatters the stand-in built: proof the reference really runs without the cache. */
let freshBuilds = 0;

let fresh: {
  date: typeof cachedDate;
  money: typeof cachedMoney;
  number: typeof cachedNumber;
  relative: typeof cachedRelative;
};

beforeAll(async () => {
  vi.resetModules();
  vi.doMock('./intl-cache', () => ({
    cachedNumberFormat: (locale: string, options?: Intl.NumberFormatOptions) => {
      freshBuilds += 1;
      return new Intl.NumberFormat(locale, options);
    },
    cachedDateTimeFormat: (locale: string, options: Intl.DateTimeFormatOptions) => {
      freshBuilds += 1;
      return new Intl.DateTimeFormat(locale, options);
    },
    cachedRelativeTimeFormat: (locale: string, options: Intl.RelativeTimeFormatOptions) => {
      freshBuilds += 1;
      return new Intl.RelativeTimeFormat(locale, options);
    },
  }));
  fresh = {
    date: await import('./date'),
    money: await import('./money'),
    number: await import('./number'),
    relative: await import('./relative-time'),
  };
  vi.doUnmock('./intl-cache');
});

type Amount = number | string;
type MoneyModule = typeof cachedMoney;

/** Every input whose cached and fresh outputs differ, with both outputs. */
function differences<Input>(
  inputs: readonly Input[],
  cached: (input: Input) => string,
  reference: (input: Input) => string,
) {
  return inputs
    .map((input) => ({ input, cached: cached(input), fresh: reference(input) }))
    .filter((row) => row.cached !== row.fresh);
}

const TRIMMED = { trimWholeDecimals: true };

describe.each(LOCALES)('cached formatters print what fresh ones do (%s)', (locale) => {
  it('the reference builds a new formatter on every call', () => {
    const before = freshBuilds;
    fresh.date.formatDate(INSTANTS[0]!, locale);
    fresh.date.formatDate(INSTANTS[0]!, locale);
    expect(freshBuilds - before).toBe(2);
  });

  it.each(['formatDate', 'formatTime'] as const)('%s, 500 seeded instants', (name) => {
    const print = (date: typeof cachedDate) => (at: number) => date[name](at, locale);
    expect(differences(INSTANTS, print(cachedDate), print(fresh.date))).toEqual([]);
  });

  it.each([
    ['formatMoney', (money: MoneyModule, value: Amount) => money.formatMoney(value, locale)],
    ['formatMoney trimmed', (money: MoneyModule, value: Amount) => money.formatMoney(value, locale, TRIMMED)],
    ['formatMoneyAmount', (money: MoneyModule, value: Amount) => money.formatMoneyAmount(value, locale)],
    ['formatMoneyAmount trimmed', (money: MoneyModule, value: Amount) => money.formatMoneyAmount(value, locale, TRIMMED)],
    ['formatMoneyExact', (money: MoneyModule, value: Amount) => money.formatMoneyExact(value, locale)],
  ] as const)('%s, 500 seeded values', (_name, print) => {
    expect(differences(AMOUNTS, (value) => print(cachedMoney, value), (value) => print(fresh.money, value))).toEqual([]);
  });

  it.each(['formatPercent', 'formatQuantity'] as const)('%s, 500 seeded values', (name) => {
    const print = (number: typeof cachedNumber) => (value: Amount) => number[name](value, locale);
    expect(differences(AMOUNTS, print(cachedNumber), print(fresh.number))).toEqual([]);
  });

  it('formatRelativeTime from now to a week', () => {
    const now = Date.UTC(2026, 9, 12, 9, 30);
    const elapsed = [0, 59_000, MINUTE, 59 * MINUTE, HOUR, 23 * HOUR, DAY, 6 * DAY, 7 * DAY];
    const instants = elapsed.map((ago) => new Date(now - ago).toISOString());
    expect(
      differences(
        instants,
        (iso) => cachedRelative.formatRelativeTime(iso, now, locale),
        (iso) => fresh.relative.formatRelativeTime(iso, now, locale),
      ),
    ).toEqual([]);
  });
});
