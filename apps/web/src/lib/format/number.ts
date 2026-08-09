// Western (Latin) digits everywhere, in BOTH locales (§4.1). The `-u-nu-latn`
// Unicode extension forces the latn numbering system; ar-EG uses comma/period
// separators, matching Egyptian business and tax documents.

function latnLocale(locale: string): string {
  return locale.includes('-u-nu-') ? locale : `${locale}-u-nu-latn`;
}

export function formatNumber(
  value: number | string,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat(latnLocale(locale), options).format(n);
}

export { latnLocale };
