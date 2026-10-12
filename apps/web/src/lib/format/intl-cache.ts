// One Intl formatter per (locale, options), built once per isolate and reused.
// Building an Intl.DateTimeFormat or NumberFormat costs tens of microseconds
// (the locale data is resolved each time); formatting with a built one costs
// about one. A page of dated rows and amounts built one per value. PURE and
// CLIENT-SAFE: no imports.
//
// BOUNDED, NEVER EVICTED: each kind keeps at most FORMATTERS_PER_KIND. Past that
// a formatter is built and returned uncached, so the cache can neither churn
// nor grow without bound, and the answer is the same either way. A constructor
// that throws (an invalid locale or option: RangeError) throws unchanged, and
// nothing is cached.

const FORMATTERS_PER_KIND = 64;

type FormatterCache<Formatter> = Map<string, Formatter>;

const numberFormats: FormatterCache<Intl.NumberFormat> = new Map();
const dateTimeFormats: FormatterCache<Intl.DateTimeFormat> = new Map();
const relativeTimeFormats: FormatterCache<Intl.RelativeTimeFormat> = new Map();

/** One option value, typed, or null when it cannot be told apart safely by text
 *  (NaN, Infinity and null all print as "null" in JSON; anything else is not an
 *  Intl option value). An undefined option is an absent one, to Intl too. */
function typedValue(value: unknown): string | null {
  if (typeof value === 'string') return `s${value}`;
  if (typeof value === 'boolean') return `b${value}`;
  if (typeof value === 'number' && Number.isFinite(value)) return `n${value}`;
  if (value === undefined) return 'u';
  return null;
}

/**
 * The key of an options object, or null to build UNCACHED (Round E F3). Only a
 * plain object of own, enumerable, data properties holding strings, booleans
 * or finite numbers is keyed: Intl also reads inherited and non-enumerable
 * properties and getters, which a key built from own entries would miss, and a
 * NaN or null option must throw or behave exactly as a fresh constructor does.
 * Entries are sorted, so key order does not matter.
 */
function optionsKey(options: object): string | null {
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertySymbols(options).length > 0) return null;
  const entries: Array<[string, string]> = [];
  for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(options))) {
    if (!descriptor.enumerable || !('value' in descriptor)) return null;
    const typed = typedValue(descriptor.value);
    if (typed === null) return null;
    entries.push([name, typed]);
  }
  return JSON.stringify(entries.sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** A FROZEN options object cannot change, so its key is worked out once. The
 *  callers' option constants are frozen; any other object is keyed per call. */
const frozenOptionKeys = new WeakMap<object, string | null>();

function cacheKey(locale: string, options: object | undefined): string | null {
  if (options === undefined) return JSON.stringify(locale);
  let key = frozenOptionKeys.get(options);
  if (key === undefined) {
    key = optionsKey(options);
    if (Object.isFrozen(options)) frozenOptionKeys.set(options, key);
  }
  return key === null ? null : `${JSON.stringify(locale)}${key}`;
}

function cachedFormatter<Formatter>(
  cache: FormatterCache<Formatter>,
  locale: string,
  options: object | undefined,
  build: () => Formatter,
): Formatter {
  const key = cacheKey(locale, options);
  if (key === null) return build();
  const cached = cache.get(key);
  if (cached) return cached;
  const formatter = build();
  if (cache.size < FORMATTERS_PER_KIND) cache.set(key, formatter);
  return formatter;
}

export function cachedNumberFormat(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  return cachedFormatter(numberFormats, locale, options, () => new Intl.NumberFormat(locale, options));
}

export function cachedDateTimeFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return cachedFormatter(dateTimeFormats, locale, options, () => new Intl.DateTimeFormat(locale, options));
}

export function cachedRelativeTimeFormat(
  locale: string,
  options: Intl.RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  return cachedFormatter(relativeTimeFormats, locale, options, () => new Intl.RelativeTimeFormat(locale, options));
}
