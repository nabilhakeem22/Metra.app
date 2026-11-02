// Does studio-typed text hold something a reader, or a mail client, takes for a
// link? PURE and CLIENT-SAFE. Deliberately narrow: an `http` or `https` scheme, a
// `www.` host, or a dot-domain shape. A name with a dot in it stays a name: "A.B.
// Design", "Eng.Ahmed", "Co.Ltd", "م.أحمد". The price of a miss is a lure in an
// email and of a false hit one generic word in it, so a shape a name could share
// with a domain ("Ahmed.Ali") counts as a domain.

const SCHEME = /\bhttps?:/i;
const WWW_HOST = /\bwww\.\S/i;
/** Latin labels and a last label of letters (or punycode), wherever they stand: an Arabic letter or comma beside them does not hide them. */
const DOT_DOMAIN = /(?<![a-z0-9.-])((?:[a-z0-9-]+\.)+)(xn--[a-z0-9-]+|[a-z]{2,})(?![a-z0-9-])/gi;
/** The Arabic top-level domains in use here. Any other Arabic text around a dot ("م.أحمد") is a name. */
const ARABIC_DOT_DOMAIN = /[\p{L}\p{N}-]{2,}\.(?:مصر|موقع|شبكة|كوم)(?![\p{L}\p{N}])/u;
/** The titles and company words a name glues to the next word: "Eng.Ahmed", "Co.Ltd". */
const GLUED_ABBREVIATIONS: ReadonlySet<string> = new Set(['arch', 'co', 'dr', 'eng', 'mr', 'mrs', 'ms', 'no', 'prof', 'st']);

/** An initial ("J.P.Morgan"), or an abbreviation glued to a capitalised word: a name, though a domain has the same shape. */
function readsAsName(labels: string, lastLabel: string): boolean {
  const beforeLast = labels.split('.').at(-2) ?? '';
  if (/^[A-Z]$/.test(beforeLast)) return true;
  const isOneDot = labels.indexOf('.') === labels.length - 1;
  return isOneDot && GLUED_ABBREVIATIONS.has(beforeLast.toLowerCase()) && /^[A-Z][a-z]/.test(lastLabel);
}

/** Compatibility forms folded (fullwidth letters and dots), invisible characters removed, so neither hides a link. */
function asReadByAMailClient(text: string): string {
  return text.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\u3002/g, '.');
}

export function holdsUrlLikeText(text: string): boolean {
  const read = asReadByAMailClient(text);
  if (SCHEME.test(read) || WWW_HOST.test(read) || ARABIC_DOT_DOMAIN.test(read)) return true;
  return [...read.matchAll(DOT_DOMAIN)].some(([, labels, lastLabel]) => !readsAsName(labels, lastLabel));
}
