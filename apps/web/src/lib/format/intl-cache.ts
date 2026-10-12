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

function cachedFormatter<Formatter>(
  cache: FormatterCache<Formatter>,
  locale: string,
  options: object | undefined,
  build: () => Formatter,
): Formatter {
  const key = `${locale}|${JSON.stringify(options ?? null)}`;
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
