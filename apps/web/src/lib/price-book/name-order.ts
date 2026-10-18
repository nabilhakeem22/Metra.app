// How a price book names and orders its rows BY NAME, in the page's language.
// Pure and client-safe: it names a row and sorts a list the server sent whole
// (the BOQ template). What is typed is folded by lib/search/fold.ts, which the
// price-book page and the builder's picker search with in Postgres.

/** A row's name in the page's language, the other language when that one is empty. */
export function nameIn(row: { nameAr: string | null; nameEn: string | null }, locale: string): string {
  const [first, second] = locale.startsWith('ar') ? [row.nameAr, row.nameEn] : [row.nameEn, row.nameAr];
  return (first?.trim() ? first : second) ?? '';
}

/** Orders rows by their name in the page's language (Arabic or English collation). */
export function byName(locale: string): (a: { nameAr: string | null; nameEn: string | null }, b: { nameAr: string | null; nameEn: string | null }) => number {
  const collator = new Intl.Collator(locale.startsWith('ar') ? 'ar' : 'en', { numeric: true, sensitivity: 'base' });
  return (a, b) => collator.compare(nameIn(a, locale), nameIn(b, locale));
}
