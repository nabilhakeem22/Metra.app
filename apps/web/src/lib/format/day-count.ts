// "6 days" / «6 أيام»: a count of days as a phrase, for copy built outside the
// message catalogues (the automation emails). PURE and client-safe. Latin digits
// always. Arabic agrees with the number the way Egyptian speech does, by the
// language's own plural categories: 1 يوم, 2 يومين, 3 to 10 أيام, 11 and up يوم.
const ARABIC_PLURAL = new Intl.PluralRules('ar');

export function dayCountPhrase(days: number, locale: string): string {
  if (!locale.startsWith('ar')) return days === 1 ? '1 day' : `${days} days`;
  switch (ARABIC_PLURAL.select(days)) {
    case 'one':
      return 'يوم';
    case 'two':
      return 'يومين';
    case 'few':
      return `${days} أيام`;
    default:
      return `${days} يوم`;
  }
}
