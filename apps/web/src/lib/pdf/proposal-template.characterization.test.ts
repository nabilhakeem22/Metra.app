// CHARACTERIZATION of buildProposalHtml: the document it returns, byte for byte,
// and when it reads its input around the one await it makes (the fonts). Written
// against the builder as it stood BEFORE its totals table was named, and not
// edited since: a refactor that changes a figure, a label, a space, a line
// break, an escape, the number's year, whether the margin prints, when a value
// is read, how often the fonts are asked for, or the error for a bad input
// fails here.
//
// Three layers. Named scenarios compare one table, heading or line against a
// literal. Two whole documents are compared against golden files a human can
// read (proposal-template.golden.*.html). A generated grid (one factor at a
// time, the pairs that matter, 300 seeded random cases, and every named input)
// is compared by digest (proposal-template.golden-digests.json). Every golden
// and digest is the unsplit builder's own output.
//
// ./template is doubled so the fonts are a value the test chooses and a moment
// it can act in; everything else (the priced table, the formatters, the
// escaper, the numbering) runs for real.
import { describe, expect, it, vi } from 'vitest';
import type { ProposalDetail } from '@/lib/proposals/queries';
import { baseOf, digestOf, oneFactorAtATime, randomCases, readGolden, type ChoiceOf } from '@/test/golden-cases';
import { ABSENT, FONT_CSS, MONEY_SETS, PRICED_POOLS, SECTION_SETS } from '@/test/priced-document-cases';
import recorded from './proposal-template.golden-digests.json';

vi.mock('server-only', () => ({}));
const fonts = vi.hoisted(() => ({ css: '', calls: 0, argCount: -1, whenAsked: null as null | (() => void) }));
vi.mock('./template', () => ({
  fontFaceCss: async (...args: unknown[]) => {
    fonts.calls += 1;
    fonts.argCount = args.length;
    fonts.whenAsked?.();
    return fonts.css;
  },
}));

const { buildProposalHtml } = await import('./proposal-template');

type BuildOptions = Parameters<typeof buildProposalHtml>[1];

// The FIRST value of each pool is the base.
const POOLS = {
  ...PRICED_POOLS,
  issueDate: [null, '2026-03-01', '2025-02-28', '2027-01-01T00:30:00.000Z', ''],
};
type Choice = ChoiceOf<typeof POOLS>;

const BASE = baseOf(POOLS);
const FULL: Choice = {
  ...BASE,
  locale: 'ar-EG',
  variant: 'internal',
  org: POOLS.org[1],
  client: POOLS.client[1],
  title: POOLS.title[1],
  number: 123,
  createdAt: POOLS.createdAt[1],
  money: 'b',
  taxRate: '14.5',
  supervisionPct: '7.25',
  grand: '294500.8088',
  totalMargin: '12345.678',
  sections: 'twoThree',
  fonts: FONT_CSS,
  issueDate: '2025-02-28',
};

interface Built {
  detail: Record<string, unknown>;
  opts: Record<string, unknown>;
}

/** A full proposal and its options, built fresh: the fixed fields are those of proposal-template.test.ts. */
function proposalOf(choice: Choice): Built {
  const detail: Record<string, unknown> = {
    id: 'p1',
    revision: '1789000000000000',
    number: choice.number,
    titleAr: choice.title[0],
    titleEn: choice.title[1],
    status: 'draft',
    kind: 'quote',
    engagementId: null,
    currency: 'EGP',
    issueDate: choice.issueDate,
    expiryDate: null,
    createdAt: choice.createdAt,
    version: 1,
    supersedesId: null,
    clientId: 'c1',
    projectId: 'j1',
    clientNameEn: choice.client[1],
    clientNameAr: choice.client[0],
    discountPct: '0',
    taxRate: choice.taxRate,
    supervisionPct: choice.supervisionPct,
    ...MONEY_SETS[choice.money],
    taxableBase: '1000',
    total: choice.grand,
    notesAr: null,
    notesEn: null,
    termsAr: null,
    termsEn: null,
    sections: SECTION_SETS[choice.sections](),
  };
  if (choice.totalMargin !== ABSENT) detail.totalMargin = choice.totalMargin;
  return {
    detail,
    opts: { locale: choice.locale, variant: choice.variant, orgNameAr: choice.org[0], orgNameEn: choice.org[1] },
  };
}

/** One build: its input, the fonts it is answered with, and what happens to the input while they load. */
interface Run {
  id: string;
  build: () => { detail: unknown; opts: unknown };
  css: string;
  whileFontsLoad?: (live: { detail: unknown; opts: unknown }) => void;
}

interface Outcome {
  /** The document, or `THROWN <the error's class>`: never V8's message. */
  output: string;
  error: unknown;
  fontCalls: number;
  fontArgCount: number;
}

async function attempt(run: Run): Promise<Outcome> {
  const live = run.build();
  fonts.css = run.css;
  fonts.calls = 0;
  fonts.argCount = -1;
  fonts.whenAsked = run.whileFontsLoad ? () => run.whileFontsLoad?.(live) : null;
  let output: string;
  let error: unknown = null;
  try {
    output = await buildProposalHtml(live.detail as ProposalDetail, live.opts as BuildOptions);
  } catch (thrown) {
    error = thrown;
    output = 'THROWN ' + (thrown as Error).constructor.name;
  }
  fonts.whenAsked = null;
  return { output, error, fontCalls: fonts.calls, fontArgCount: fonts.argCount };
}

const ofChoice = (id: string, choice: Choice): Run => ({ id, build: () => proposalOf(choice), css: choice.fonts });
const withBase = (id: string, changes: Partial<Choice>): Run => ofChoice(id, { ...BASE, ...changes });

// ---------------------------------------------------------------- named inputs

const EN_CLIENT_GOLDEN = withBase('golden/en-client', { sections: 'twoThree' });
const AR_INTERNAL_GOLDEN = ofChoice('golden/ar-internal', { ...FULL, org: BASE.org, client: BASE.client, title: BASE.title });

const P_T1 = withBase('P-T1/base', {});

const P_T2 = {
  internal: POOLS.totalMargin.map((totalMargin, i) => withBase(`P-T2/internal/${i}`, { variant: 'internal', totalMargin })),
  client: withBase('P-T2/client/300', { variant: 'client', totalMargin: '300' }),
};

const P_T3 = {
  issueDate: POOLS.issueDate.map((issueDate, i) => withBase(`P-T3/issueDate/${i}`, { issueDate })),
  createdAt: POOLS.createdAt.map((createdAt, i) => withBase(`P-T3/createdAt/${i}`, { createdAt })),
  number: POOLS.number.map((number, i) => withBase(`P-T3/number/${i}`, { number })),
};

const P_T4 = POOLS.org.map((org, i) => withBase(`P-T4/org/${i}`, { org }));

const P_T5 = {
  none: withBase('P-T5/no-fonts', { fonts: '' }),
  embedded: withBase('P-T5/fonts', { fonts: FONT_CSS }),
};

// P-T6: the input changes WHILE the fonts load. `a` starts as `before` and
// becomes `after`; `b` is the reverse.
const otherLocale = (locale: string) => (locale === 'en' ? 'ar-EG' : 'en');
const beforeFonts = (locale: string): Choice => ({
  ...BASE,
  locale,
  variant: 'internal',
  totalMargin: '300',
  sections: 'twoThree',
});
const afterFonts = (locale: string): Choice => ({
  ...FULL,
  locale: otherLocale(locale),
  variant: 'client',
  createdAt: POOLS.createdAt[2],
  sections: 'oneOne',
});
const changing = (id: string, from: Choice, into: Choice): Run => ({
  id,
  build: () => proposalOf(from),
  css: from.fonts,
  whileFontsLoad: (live) => {
    const next = proposalOf(into);
    Object.assign(live.detail as object, next.detail);
    Object.assign(live.opts as object, next.opts);
  },
});
const P_T6 = {
  enA: changing('fonts/en/a', beforeFonts('en'), afterFonts('en')),
  enB: changing('fonts/en/b', afterFonts('en'), beforeFonts('en')),
  arA: changing('fonts/ar-EG/a', beforeFonts('ar-EG'), afterFonts('ar-EG')),
  arB: changing('fonts/ar-EG/b', afterFonts('ar-EG'), beforeFonts('ar-EG')),
};

// P-T7: bad input. Each is the base with one thing broken.
const broken = (id: string, change: (built: Built) => { detail: unknown; opts: unknown }): Run => ({
  id: `bad/${id}`,
  build: () => change(proposalOf(BASE)),
  css: '',
});
const withDetail = (id: string, over: Record<string, unknown>) =>
  broken(id, ({ detail, opts }) => ({ detail: { ...detail, ...over }, opts }));
const withOpts = (id: string, over: Record<string, unknown>) =>
  broken(id, ({ detail, opts }) => ({ detail, opts: { ...opts, ...over } }));
const P_T7 = {
  detailNull: broken('detail-null', ({ opts }) => ({ detail: null, opts })),
  detailUndefined: broken('detail-undefined', ({ opts }) => ({ detail: undefined, opts })),
  optsUndefined: broken('opts-undefined', ({ detail }) => ({ detail, opts: undefined })),
  optsNull: broken('opts-null', ({ detail }) => ({ detail, opts: null })),
  localeUndefined: withOpts('locale-undefined', { locale: undefined }),
  localeNumber: withOpts('locale-number', { locale: 7 }),
  optsEmpty: broken('opts-empty', ({ detail }) => ({ detail, opts: {} })),
  sectionsUndefined: withDetail('sections-undefined', { sections: undefined }),
  sectionsNull: withDetail('sections-null', { sections: null }),
  linesUndefined: withDetail('lines-undefined', { sections: [{ ...SECTION_SETS.oneOne()[0], lines: undefined }] }),
  detailEmpty: broken('detail-empty', ({ opts }) => ({ detail: {}, opts })),
  localeInvalid: withOpts('locale-invalid', { locale: 'not a locale!' }),
  variantUppercase: withOpts('variant-uppercase', { variant: 'INTERNAL' }),
  numberUndefined: withDetail('number-undefined', { number: undefined }),
  amountsAsNumbers: withDetail('amounts-as-numbers', {
    subtotal: 1000,
    discountAmount: 0,
    taxAmount: 140,
    supervisionAmount: 100,
    total: 1240,
    taxRate: 14,
    supervisionPct: 10,
  }),
  subtotalNull: withDetail('subtotal-null', { subtotal: null }),
};

// ------------------------------------------------------------------- the grid

const pairAr = Object.entries(POOLS).flatMap(([key, pool]) =>
  pool.map((value, i) => ofChoice(`pair/ar/${key}/${i}`, { ...BASE, locale: 'ar-EG', [key]: value } as Choice)),
);

const RUNS: Run[] = [
  ...oneFactorAtATime(POOLS).map(({ id, choice }) => ofChoice(id, choice)),
  ...POOLS.totalMargin.map((totalMargin, i) => withBase(`pair/internal-margin/${i}`, { variant: 'internal', totalMargin })),
  ...POOLS.sections.map((sections, i) => withBase(`pair/internal-sections/${i}`, { variant: 'internal', sections })),
  ...pairAr,
  ofChoice('pair/full-ar-internal', FULL),
  ...randomCases(POOLS, 20261116, 300).map(({ id, choice }) => ofChoice(id, choice)),
  EN_CLIENT_GOLDEN,
  AR_INTERNAL_GOLDEN,
  P_T1,
  ...P_T2.internal,
  P_T2.client,
  ...P_T3.issueDate,
  ...P_T3.createdAt,
  ...P_T3.number,
  ...P_T4,
  ...Object.values(P_T5),
  ...Object.values(P_T6),
  ...Object.values(P_T7),
];

// ------------------------------------------------------------ reading a document

const documentOf = async (run: Run): Promise<string> => (await attempt(run)).output;

/** From the first `open` to the end of the first `close` after it. */
function fragment(html: string, open: string, close: string): string {
  const start = html.indexOf(open);
  const end = html.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error(`no ${open} ... ${close} in the document`);
  return html.slice(start, end + close.length);
}
const totalsOf = (html: string) => fragment(html, '<table class="totals">', '</table>');
const headingOf = (html: string) => fragment(html, '<h1>', '</h1>');
const footerOf = (html: string) => fragment(html, '<div class="footer">', '</div>');
const numberOf = (html: string) => fragment(html, '<strong>', '</strong>');
const sectionsOf = (html: string) => fragment(html, '<table dir=', '</table>');
const occurrences = (html: string, text: string) => html.split(text).length - 1;

/** A row that is not printed leaves its line behind: four spaces. */
const NO_ROW = '    ';

/** The base's totals, with the one conditional line given. */
const baseTotals = (marginLine: string) =>
  [
    '<table class="totals">',
    '    <tr><td>Subtotal</td><td class="num">1,000.00 EGP</td></tr>',
    '    <tr><td>Discount</td><td class="num">0.00 EGP</td></tr>',
    '    <tr><td>VAT (14.00%)</td><td class="num">140.00 EGP</td></tr>',
    '    <tr><td>Supervision (10.00%)</td><td class="num">100.00 EGP</td></tr>',
    '    <tr class="grand"><td>Total</td><td class="num">1,240.00 EGP</td></tr>',
    marginLine,
    '  </table>',
  ].join('\n');

const marginRow = (figure: string) => `    <tr><td>Margin</td><td class="num">${figure}</td></tr>`;

// ------------------------------------------------------------------ the tests

describe('buildProposalHtml, the whole document', () => {
  it('is the English client golden', async () => {
    expect(await documentOf(EN_CLIENT_GOLDEN)).toBe(readGolden(new URL('./proposal-template.golden.en-client.html', import.meta.url)));
  });

  it('is the Arabic internal golden', async () => {
    expect(await documentOf(AR_INTERNAL_GOLDEN)).toBe(readGolden(new URL('./proposal-template.golden.ar-internal.html', import.meta.url)));
  });

  it('digests as recorded for every case of the grid, and asks for the fonts once, with no argument, whenever it returns', async () => {
    expect(new Set(RUNS.map((run) => run.id)).size).toBe(RUNS.length);
    const digests: Record<string, string> = {};
    const fontRequests = new Set<string>();
    for (const run of RUNS) {
      const outcome = await attempt(run);
      digests[run.id] = digestOf(outcome.output);
      if (outcome.error === null) fontRequests.add(`${outcome.fontCalls} call, ${outcome.fontArgCount} arguments`);
    }
    expect(digests).toEqual(recorded);
    expect([...fontRequests]).toEqual(['1 call, 0 arguments']);
  });
});

describe('buildProposalHtml, the totals table', () => {
  it('P-T1: prints subtotal to total, then ONE empty line, on the base', async () => {
    expect(totalsOf(await documentOf(P_T1))).toBe(baseTotals(NO_ROW));
  });

  it('P-T2: prints the margin on the internal variant whenever the key holds anything but undefined', async () => {
    const [absent, undefinedMargin, threeHundred, zero, empty, large, nullMargin] = P_T2.internal;
    expect(totalsOf(await documentOf(absent))).toBe(baseTotals(NO_ROW));
    expect(totalsOf(await documentOf(undefinedMargin))).toBe(baseTotals(NO_ROW));
    expect(totalsOf(await documentOf(threeHundred))).toBe(baseTotals(marginRow('300.00 EGP')));
    expect(totalsOf(await documentOf(zero))).toBe(baseTotals(marginRow('0.00 EGP')));
    expect(totalsOf(await documentOf(empty))).toBe(baseTotals(marginRow('')));
    expect(totalsOf(await documentOf(large))).toBe(baseTotals(marginRow('12,345.68 EGP')));
    expect(totalsOf(await documentOf(nullMargin))).toBe(baseTotals(marginRow('')));
  });

  it('P-T2: never prints the margin on the client variant', async () => {
    const html = await documentOf(P_T2.client);
    expect(totalsOf(html)).toBe(baseTotals(NO_ROW));
    expect(html).not.toContain('Margin');
  });
});

describe('buildProposalHtml, the heading, the footer and the number', () => {
  it('P-T3: takes the year from the issue date when there is one, else from the creation date in Cairo', async () => {
    const [nullDate, sameYear, earlierYear, timestamp, empty] = P_T3.issueDate;
    expect(numberOf(await documentOf(nullDate))).toBe('<strong>Q-2026-0004</strong>');
    expect(numberOf(await documentOf(sameYear))).toBe('<strong>Q-2026-0004</strong>');
    expect(numberOf(await documentOf(earlierYear))).toBe('<strong>Q-2025-0004</strong>');
    // A timestamp is read by its Cairo year: 00:30 UTC on 1 January 2027.
    expect(numberOf(await documentOf(timestamp))).toBe('<strong>Q-2027-0004</strong>');
    expect(numberOf(await documentOf(empty))).toBe('<strong>Q-2026-0004</strong>');

    const [march, newYearInCairo, earlier, notADate] = P_T3.createdAt;
    expect(numberOf(await documentOf(march))).toBe('<strong>Q-2026-0004</strong>');
    // 22:30 UTC on 31 December 2025 is 00:30 on 1 January 2026 in Cairo.
    expect(numberOf(await documentOf(newYearInCairo))).toBe('<strong>Q-2026-0004</strong>');
    expect(numberOf(await documentOf(earlier))).toBe('<strong>Q-2024-0004</strong>');
    expect(numberOf(await documentOf(notADate))).toBe('<strong>Q-NaN-0004</strong>');
  });

  it('P-T3: prints the number with four digits at least', async () => {
    const [four, oneTwoThree, fiveDigits] = P_T3.number;
    expect(numberOf(await documentOf(four))).toBe('<strong>Q-2026-0004</strong>');
    expect(numberOf(await documentOf(oneTwoThree))).toBe('<strong>Q-2026-0123</strong>');
    expect(numberOf(await documentOf(fiveDigits))).toBe('<strong>Q-2026-12345</strong>');
  });

  it('P-T4: names the studio once in the heading and once in the footer; only the heading falls back to Metra', async () => {
    const expected: Array<[heading: string, footer: string, name: string | null]> = [
      ['<h1>Metra</h1>', '<div class="footer">Metra · Q-2026-0004</div>', 'Metra'],
      ['<h1>Hassan &amp; Sons</h1>', '<div class="footer">Hassan &amp; Sons · Q-2026-0004</div>', 'Hassan &amp; Sons'],
      ['<h1>استوديو النيل</h1>', '<div class="footer">استوديو النيل · Q-2026-0004</div>', 'استوديو النيل'],
      // No name in either language: the heading falls back, the footer does not.
      ['<h1>Metra</h1>', '<div class="footer"> · Q-2026-0004</div>', null],
      ['<h1>Atelier &quot;Nine&quot;</h1>', '<div class="footer">Atelier &quot;Nine&quot; · Q-2026-0004</div>', 'Atelier &quot;Nine&quot;'],
      // A name of spaces only is a name: no fallback.
      ['<h1>   </h1>', '<div class="footer">    · Q-2026-0004</div>', null],
      ['<h1>   </h1>', '<div class="footer">    · Q-2026-0004</div>', null],
      ['<h1>O&#39;Brien &lt;Design&gt;</h1>', '<div class="footer">O&#39;Brien &lt;Design&gt; · Q-2026-0004</div>', 'O&#39;Brien &lt;Design&gt;'],
    ];
    expect(P_T4).toHaveLength(expected.length);
    for (const [i, [heading, footer, name]] of expected.entries()) {
      const html = await documentOf(P_T4[i]);
      expect(headingOf(html)).toBe(heading);
      expect(footerOf(html)).toBe(footer);
      if (name !== null) expect(occurrences(html, name)).toBe(2);
    }
  });
});

describe('buildProposalHtml, the fonts', () => {
  it('P-T5: leaves two spaces on a line of their own when there are none', async () => {
    const outcome = await attempt(P_T5.none);
    expect(outcome.output).toContain('<style>\n  \n  * { box-sizing: border-box; }');
    expect([outcome.fontCalls, outcome.fontArgCount]).toEqual([1, 0]);
  });

  it('P-T5: puts the font faces after those two spaces, first in the style block', async () => {
    const outcome = await attempt(P_T5.embedded);
    expect(outcome.output).toContain(`<style>\n  ${FONT_CSS}\n  * { box-sizing: border-box; }`);
    expect([outcome.fontCalls, outcome.fontArgCount]).toEqual([1, 0]);
  });

  it('P-T6: reads the head and the variant BEFORE the fonts load, and the tables after (en, a)', async () => {
    const html = await documentOf(P_T6.enA);
    // Read before: the language, the studio, the number, the variant.
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(headingOf(html)).toBe('<h1>Metra</h1>');
    expect(numberOf(html)).toBe('<strong>Q-2026-0004</strong>');
    expect(html).toContain('<th class="num">Cost</th>');
    expect(html).toContain('<th class="num">Margin</th>');
    // Read after: the sections, the amounts, the margin.
    expect(occurrences(sectionsOf(html), '<tr class="section">')).toBe(1);
    expect(sectionsOf(html)).toContain('<td class="desc">Item 1</td>');
    expect(totalsOf(html)).toBe(
      [
        '<table class="totals">',
        '    <tr><td>Subtotal</td><td class="num">250,000.50 EGP</td></tr>',
        '    <tr><td>Discount</td><td class="num">12,500.25 EGP</td></tr>',
        '    <tr><td>VAT (14.50%)</td><td class="num">33,250.04 EGP</td></tr>',
        '    <tr><td>Supervision (7.25%)</td><td class="num">23,750.02 EGP</td></tr>',
        '    <tr class="grand"><td>Total</td><td class="num">294,500.81 EGP</td></tr>',
        marginRow('12,345.68 EGP'),
        '  </table>',
      ].join('\n'),
    );
  });

  it('P-T6: the same split of reads in the reverse change (en, b)', async () => {
    const html = await documentOf(P_T6.enB);
    expect(html).toContain('<html lang="ar-EG" dir="rtl">');
    expect(headingOf(html)).toBe('<h1>Hassan &amp; Sons</h1>');
    expect(numberOf(html)).toBe('<strong>Q-2025-0123</strong>');
    // The client variant was read before: no cost column, no margin row, although the input became internal.
    expect(html).not.toContain('التكلفة');
    expect(html).not.toContain('هامش الربح');
    expect(occurrences(sectionsOf(html), '<tr class="section">')).toBe(2);
    expect(totalsOf(html)).toContain('<tr class="grand"><td>الإجمالي</td><td class="num">1,240.00 ج.م</td></tr>');
    expect(totalsOf(html)).toContain('<td class="num">1,000.00 ج.م</td>');
  });

  it('P-T6: the same split of reads starting in Arabic (ar-EG, a and b)', async () => {
    const a = await documentOf(P_T6.arA);
    expect(a).toContain('<html lang="ar-EG" dir="rtl">');
    expect(headingOf(a)).toBe('<h1>ميترا</h1>');
    expect(numberOf(a)).toBe('<strong>Q-2026-0004</strong>');
    expect(a).toContain('<th class="num">التكلفة</th>');
    expect(occurrences(sectionsOf(a), '<tr class="section">')).toBe(1);
    expect(totalsOf(a)).toContain('<tr class="grand"><td>الإجمالي</td><td class="num">294,500.81 ج.م</td></tr>');
    expect(totalsOf(a)).toContain('<tr><td>هامش الربح</td><td class="num">12,345.68 ج.م</td></tr>');

    const b = await documentOf(P_T6.arB);
    expect(b).toContain('<html lang="en" dir="ltr">');
    expect(headingOf(b)).toBe('<h1>Hassan &amp; Sons</h1>');
    expect(numberOf(b)).toBe('<strong>Q-2025-0123</strong>');
    expect(b).not.toContain('Cost');
    expect(b).not.toContain('Margin');
    expect(occurrences(sectionsOf(b), '<tr class="section">')).toBe(2);
    expect(totalsOf(b)).toBe(baseTotals(NO_ROW));
  });
});

describe('buildProposalHtml, bad input', () => {
  it('P-T7: rejects before the fonts are asked for when the detail or the options cannot be read', async () => {
    const before: Array<[run: Run, message: RegExp]> = [
      [P_T7.detailNull, /reading 'number'/],
      [P_T7.detailUndefined, /reading 'number'/],
      [P_T7.optsUndefined, /'locale' of 'opts'/],
      [P_T7.optsNull, /'locale' of 'opts'/],
      [P_T7.localeUndefined, /startsWith/],
      [P_T7.localeNumber, /startsWith/],
      [P_T7.optsEmpty, /startsWith/],
    ];
    for (const [run, message] of before) {
      const outcome = await attempt(run);
      expect([run.id, outcome.output, outcome.fontCalls]).toEqual([run.id, 'THROWN TypeError', 0]);
      expect((outcome.error as Error).message).toMatch(message);
    }
  });

  it('P-T7: rejects after the fonts were asked for once when a table cannot be built', async () => {
    const after: Array<[run: Run, thrown: string]> = [
      [P_T7.sectionsUndefined, 'THROWN TypeError'],
      [P_T7.sectionsNull, 'THROWN TypeError'],
      [P_T7.linesUndefined, 'THROWN TypeError'],
      [P_T7.detailEmpty, 'THROWN TypeError'],
      [P_T7.localeInvalid, 'THROWN RangeError'],
    ];
    for (const [run, thrown] of after) {
      const outcome = await attempt(run);
      expect([run.id, outcome.output, outcome.fontCalls]).toEqual([run.id, thrown, 1]);
    }
  });

  it('P-T7: resolves on a variant it does not know (the client layout), a missing number, numbers for amounts and a null amount', async () => {
    const uppercase = await documentOf(P_T7.variantUppercase);
    expect(uppercase).not.toContain('Cost');
    expect(uppercase).toBe(await documentOf(P_T1));

    expect(numberOf(await documentOf(P_T7.numberUndefined))).toBe('<strong>Q-2026-undefined</strong>');

    expect(totalsOf(await documentOf(P_T7.amountsAsNumbers))).toBe(baseTotals(NO_ROW));

    expect(totalsOf(await documentOf(P_T7.subtotalNull))).toContain('    <tr><td>Subtotal</td><td class="num"></td></tr>\n');
  });
});
