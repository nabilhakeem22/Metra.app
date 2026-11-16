// CHARACTERIZATION of buildContractHtml: the document it returns, byte for byte,
// and when it reads its input around the one await it makes (the fonts). Written
// against the builder as it stood BEFORE its totals and terms tables were named,
// and not edited since: a refactor that changes a figure, a label, a space, a
// line break, an escape, the number's year, which rows print, when a value is
// read, how often the fonts are asked for, or the error for a bad input fails
// here.
//
// Three layers. Named scenarios compare one table, heading or line against a
// literal. Two whole documents are compared against golden files a human can
// read (contract-template.golden.*.html). A generated grid (one factor at a
// time, the pairs that matter, 300 seeded random cases, and every named input)
// is compared by digest (contract-template.golden-digests.json). Every golden
// and digest is the unsplit builder's own output.
//
// ./template is doubled so the fonts are a value the test chooses and a moment
// it can act in; everything else (the priced table, the formatters, the
// escaper, the numbering) runs for real.
import { describe, expect, it, vi } from 'vitest';
import type { ContractDetail } from '@/lib/contracts/queries';
import { baseOf, digestOf, oneFactorAtATime, randomCases, readGolden, type ChoiceOf } from '@/test/golden-cases';
import { ABSENT, FONT_CSS, MONEY_SETS, PRICED_POOLS, SECTION_SETS } from '@/test/priced-document-cases';
import recorded from './contract-template.golden-digests.json';

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

const { buildContractHtml } = await import('./contract-template');

type BuildOptions = Parameters<typeof buildContractHtml>[1];

// The FIRST value of each pool is the base.
const POOLS = {
  ...PRICED_POOLS,
  revised: ['same', '1300.0000', 'scale'],
  advancePct: ['25', '0', '10.5', ''],
  retentionPct: ['5', '0', '2.75', ''],
  paymentTermsDays: [ABSENT, null, 0, 30, 45],
  startDate: [null, '', '2026-03-15', '2027-01-02', '<i>soon</i>'],
  endDate: [null, '', '2026-06-15', '2027-12-31', 'A & B'],
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
  revised: '1300.0000',
  totalMargin: '12345.678',
  advancePct: '10.5',
  retentionPct: '2.75',
  paymentTermsDays: 45,
  startDate: '2027-01-02',
  endDate: '2027-12-31',
  sections: 'twoThree',
  fonts: FONT_CSS,
};

/** `same`: the original value; `scale`: the same number written at another scale; else the value as given. */
function revisedValueOf(choice: Choice): string {
  if (choice.revised === 'same') return choice.grand;
  if (choice.revised === 'scale') return choice.grand.includes('.') ? choice.grand + '0' : choice.grand + '.0000';
  return choice.revised;
}

interface Built {
  detail: Record<string, unknown>;
  opts: Record<string, unknown>;
}

/** A full contract and its options, built fresh: the fixed fields are those of contract-template.test.ts. */
function contractOf(choice: Choice): Built {
  const detail: Record<string, unknown> = {
    id: 'k1',
    number: choice.number,
    titleAr: choice.title[0],
    titleEn: choice.title[1],
    status: 'signed',
    currency: 'EGP',
    sourceProposalId: 'p1',
    sourceBoqId: null,
    signatureDate: '2026-03-10',
    startDate: choice.startDate,
    endDate: choice.endDate,
    createdAt: choice.createdAt,
    clientId: 'c1',
    projectId: 'j1',
    clientNameEn: choice.client[1],
    clientNameAr: choice.client[0],
    retentionPct: choice.retentionPct,
    retentionReleaseTermsAr: null,
    retentionReleaseTermsEn: null,
    advancePct: choice.advancePct,
    advanceRecoveryMethod: 'pro_rata',
    paymentScheduleMode: 'milestone',
    penaltyAr: null,
    penaltyEn: null,
    defectsLiabilityDays: null,
    scopeInclusionsAr: null,
    scopeInclusionsEn: null,
    scopeExclusionsAr: null,
    scopeExclusionsEn: null,
    termsAr: null,
    termsEn: null,
    discountPct: '0',
    taxRate: choice.taxRate,
    supervisionPct: choice.supervisionPct,
    ...MONEY_SETS[choice.money],
    taxableBase: '1000',
    originalValue: choice.grand,
    revisedValue: revisedValueOf(choice),
    approvedExtensionDays: 0,
    sections: SECTION_SETS[choice.sections](),
  };
  if (choice.paymentTermsDays !== ABSENT) detail.paymentTermsDays = choice.paymentTermsDays;
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
    output = await buildContractHtml(live.detail as ContractDetail, live.opts as BuildOptions);
  } catch (thrown) {
    error = thrown;
    output = 'THROWN ' + (thrown as Error).constructor.name;
  }
  fonts.whenAsked = null;
  return { output, error, fontCalls: fonts.calls, fontArgCount: fonts.argCount };
}

const ofChoice = (id: string, choice: Choice): Run => ({ id, build: () => contractOf(choice), css: choice.fonts });
const withBase = (id: string, changes: Partial<Choice>): Run => ofChoice(id, { ...BASE, ...changes });

// ---------------------------------------------------------------- named inputs

const EN_CLIENT_GOLDEN = withBase('golden/en-client', { sections: 'twoThree', paymentTermsDays: 30, startDate: '2026-03-15' });
const AR_INTERNAL_GOLDEN = ofChoice('golden/ar-internal', { ...FULL, org: BASE.org, client: BASE.client, title: BASE.title });

const K_T1 = withBase('K-T1/base', {});

const K_T2 = {
  moved: withBase('K-T2/1300.0000', { revised: '1300.0000' }),
  scale: withBase('K-T2/scale', { revised: 'scale' }),
  same: withBase('K-T2/same', { revised: 'same' }),
};

const K_T3 = {
  internal: POOLS.totalMargin.map((totalMargin, i) => withBase(`K-T3/internal/${i}`, { variant: 'internal', totalMargin })),
  client: withBase('K-T3/client/300', { variant: 'client', totalMargin: '300' }),
};

const K_T4 = {
  paymentTermsDays: POOLS.paymentTermsDays.map((paymentTermsDays, i) => withBase(`K-T4/paymentTermsDays/${i}`, { paymentTermsDays })),
  startDate: POOLS.startDate.map((startDate, i) => withBase(`K-T4/startDate/${i}`, { startDate })),
  endDate: POOLS.endDate.map((endDate, i) => withBase(`K-T4/endDate/${i}`, { endDate })),
  noAdvance: withBase('K-T4/advancePct-empty', { advancePct: '' }),
};

const K_T5 = POOLS.org.map((org, i) => withBase(`K-T5/org/${i}`, { org }));

const K_T6 = {
  number: POOLS.number.map((number, i) => withBase(`K-T6/number/${i}`, { number })),
  createdAt: POOLS.createdAt.map((createdAt, i) => withBase(`K-T6/createdAt/${i}`, { createdAt })),
  startsNextYear: withBase('K-T6/start-in-another-year', { startDate: '2027-01-02' }),
};

const K_T7 = {
  none: withBase('K-T7/no-fonts', { fonts: '' }),
  embedded: withBase('K-T7/fonts', { fonts: FONT_CSS }),
};

// K-T8: the input changes WHILE the fonts load. `a` starts as `before` and
// becomes `after`; `b` is the reverse.
const otherLocale = (locale: string) => (locale === 'en' ? 'ar-EG' : 'en');
const beforeFonts = (locale: string): Choice => ({
  ...BASE,
  locale,
  variant: 'internal',
  totalMargin: '300',
  paymentTermsDays: 30,
  startDate: '2026-03-15',
  endDate: '2026-06-15',
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
  build: () => contractOf(from),
  css: from.fonts,
  whileFontsLoad: (live) => {
    const next = contractOf(into);
    Object.assign(live.detail as object, next.detail);
    Object.assign(live.opts as object, next.opts);
  },
});
const K_T8 = {
  enA: changing('fonts/en/a', beforeFonts('en'), afterFonts('en')),
  enB: changing('fonts/en/b', afterFonts('en'), beforeFonts('en')),
  arA: changing('fonts/ar-EG/a', beforeFonts('ar-EG'), afterFonts('ar-EG')),
  arB: changing('fonts/ar-EG/b', afterFonts('ar-EG'), beforeFonts('ar-EG')),
};

// K-T9: bad input. Each is the base with one thing broken.
const broken = (id: string, change: (built: Built) => { detail: unknown; opts: unknown }): Run => ({
  id: `bad/${id}`,
  build: () => change(contractOf(BASE)),
  css: '',
});
const withDetail = (id: string, over: Record<string, unknown>) =>
  broken(id, ({ detail, opts }) => ({ detail: { ...detail, ...over }, opts }));
const withOpts = (id: string, over: Record<string, unknown>) =>
  broken(id, ({ detail, opts }) => ({ detail, opts: { ...opts, ...over } }));
const K_T9 = {
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
  startDateNumber: withDetail('startDate-number', { startDate: 20260315 }),
  variantUppercase: withOpts('variant-uppercase', { variant: 'INTERNAL' }),
  numberUndefined: withDetail('number-undefined', { number: undefined }),
  amountsAsNumbers: withDetail('amounts-as-numbers', {
    subtotal: 1000,
    discountAmount: 0,
    taxAmount: 140,
    supervisionAmount: 100,
    originalValue: 1240,
    revisedValue: 1240,
    taxRate: 14,
    supervisionPct: 10,
    advancePct: 25,
    retentionPct: 5,
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
  ...POOLS.revised.flatMap((revised, i) => POOLS.grand.map((grand) => withBase(`pair/revised/${i}/${grand}`, { revised, grand }))),
  ...pairAr,
  ofChoice('pair/full-ar-internal', FULL),
  ...randomCases(POOLS, 20261115, 300).map(({ id, choice }) => ofChoice(id, choice)),
  EN_CLIENT_GOLDEN,
  AR_INTERNAL_GOLDEN,
  K_T1,
  ...Object.values(K_T2),
  ...K_T3.internal,
  K_T3.client,
  ...K_T4.paymentTermsDays,
  ...K_T4.startDate,
  ...K_T4.endDate,
  K_T4.noAdvance,
  ...K_T5,
  ...K_T6.number,
  ...K_T6.createdAt,
  K_T6.startsNextYear,
  ...Object.values(K_T7),
  ...Object.values(K_T8),
  ...Object.values(K_T9),
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
const termsOf = (html: string) => fragment(html, '<table class="terms totals">', '</table>');
const headingOf = (html: string) => fragment(html, '<h1>', '</h1>');
const footerOf = (html: string) => fragment(html, '<div class="footer">', '</div>');
const numberOf = (html: string) => fragment(html, '<strong>', '</strong>');
const sectionsOf = (html: string) => fragment(html, '<table dir=', '</table>');
const occurrences = (html: string, text: string) => html.split(text).length - 1;

/** A row that is not printed leaves its line behind: four spaces. */
const NO_ROW = '    ';

/** The base's totals, with the two conditional lines given. */
const baseTotals = (revisedLine: string, marginLine: string) =>
  [
    '<table class="totals">',
    '    <tr><td>Subtotal</td><td class="num">1,000.00 EGP</td></tr>',
    '    <tr><td>Discount</td><td class="num">0.00 EGP</td></tr>',
    '    <tr><td>VAT (14.00%)</td><td class="num">140.00 EGP</td></tr>',
    '    <tr><td>Supervision (10.00%)</td><td class="num">100.00 EGP</td></tr>',
    '    <tr class="grand"><td>Original value</td><td class="num">1,240.00 EGP</td></tr>',
    revisedLine,
    marginLine,
    '  </table>',
  ].join('\n');

/** The base's terms, with the three conditional lines given. */
const baseTerms = (daysLine: string, startLine: string, endLine: string) =>
  [
    '<table class="terms totals">',
    '    <tr><td>Advance %</td><td class="num">25.00%</td></tr>',
    '    <tr><td>Retention %</td><td class="num">5.00%</td></tr>',
    daysLine,
    startLine,
    endLine,
    '  </table>',
  ].join('\n');

const marginRow = (figure: string) => `    <tr><td>Margin</td><td class="num">${figure}</td></tr>`;
const termLine = (label: string, value: string) => `    <tr><td>${label}</td><td class="num">${value}</td></tr>`;

// ------------------------------------------------------------------ the tests

describe('buildContractHtml, the whole document', () => {
  it('is the English client golden', async () => {
    expect(await documentOf(EN_CLIENT_GOLDEN)).toBe(readGolden(new URL('./contract-template.golden.en-client.html', import.meta.url)));
  });

  it('is the Arabic internal golden', async () => {
    expect(await documentOf(AR_INTERNAL_GOLDEN)).toBe(readGolden(new URL('./contract-template.golden.ar-internal.html', import.meta.url)));
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

describe('buildContractHtml, the totals table', () => {
  it('K-T1: prints subtotal to original value, then two empty lines, on the base', async () => {
    const html = await documentOf(K_T1);
    expect(totalsOf(html)).toBe(baseTotals(NO_ROW, NO_ROW));
    expect(termsOf(html)).toBe(baseTerms(NO_ROW, NO_ROW, NO_ROW));
  });

  it('K-T2: prints a revised row when the two values differ AS STRINGS', async () => {
    expect(totalsOf(await documentOf(K_T2.moved))).toBe(
      baseTotals('    <tr class="grand"><td>Revised value</td><td class="num">1,300.00 EGP</td></tr>', NO_ROW),
    );
    // 1240 against 1240.0000: the same number, another string. The row IS printed.
    expect(totalsOf(await documentOf(K_T2.scale))).toBe(
      baseTotals('    <tr class="grand"><td>Revised value</td><td class="num">1,240.00 EGP</td></tr>', NO_ROW),
    );
    expect(totalsOf(await documentOf(K_T2.same))).toBe(baseTotals(NO_ROW, NO_ROW));
  });

  it('K-T3: prints the margin on the internal variant whenever the key holds anything but undefined', async () => {
    const [absent, undefinedMargin, threeHundred, zero, empty, large, nullMargin] = K_T3.internal;
    expect(totalsOf(await documentOf(absent))).toBe(baseTotals(NO_ROW, NO_ROW));
    expect(totalsOf(await documentOf(undefinedMargin))).toBe(baseTotals(NO_ROW, NO_ROW));
    expect(totalsOf(await documentOf(threeHundred))).toBe(baseTotals(NO_ROW, marginRow('300.00 EGP')));
    expect(totalsOf(await documentOf(zero))).toBe(baseTotals(NO_ROW, marginRow('0.00 EGP')));
    expect(totalsOf(await documentOf(empty))).toBe(baseTotals(NO_ROW, marginRow('')));
    expect(totalsOf(await documentOf(large))).toBe(baseTotals(NO_ROW, marginRow('12,345.68 EGP')));
    expect(totalsOf(await documentOf(nullMargin))).toBe(baseTotals(NO_ROW, marginRow('')));
  });

  it('K-T3: never prints the margin on the client variant', async () => {
    const html = await documentOf(K_T3.client);
    expect(totalsOf(html)).toBe(baseTotals(NO_ROW, NO_ROW));
    expect(html).not.toContain('Margin');
  });
});

describe('buildContractHtml, the terms table', () => {
  it('K-T4: prints the payment days whenever they are not null or absent, zero included', async () => {
    const [absent, nullDays, zero, thirty, fortyFive] = K_T4.paymentTermsDays;
    expect(termsOf(await documentOf(absent))).toBe(baseTerms(NO_ROW, NO_ROW, NO_ROW));
    expect(termsOf(await documentOf(nullDays))).toBe(baseTerms(NO_ROW, NO_ROW, NO_ROW));
    expect(termsOf(await documentOf(zero))).toBe(
      baseTerms('    <tr><td>Payment terms (days)</td><td class="num">0</td></tr>', NO_ROW, NO_ROW),
    );
    expect(termsOf(await documentOf(thirty))).toBe(baseTerms(termLine('Payment terms (days)', '30'), NO_ROW, NO_ROW));
    expect(termsOf(await documentOf(fortyFive))).toBe(baseTerms(termLine('Payment terms (days)', '45'), NO_ROW, NO_ROW));
  });

  it('K-T4: prints the start date as given when it is set, escaped once', async () => {
    const [nullDate, empty, march, nextYear, hostile] = K_T4.startDate;
    expect(termsOf(await documentOf(nullDate))).toBe(baseTerms(NO_ROW, NO_ROW, NO_ROW));
    expect(termsOf(await documentOf(empty))).toBe(baseTerms(NO_ROW, NO_ROW, NO_ROW));
    expect(termsOf(await documentOf(march))).toBe(baseTerms(NO_ROW, termLine('Start date', '2026-03-15'), NO_ROW));
    expect(termsOf(await documentOf(nextYear))).toBe(baseTerms(NO_ROW, termLine('Start date', '2027-01-02'), NO_ROW));
    expect(termsOf(await documentOf(hostile))).toBe(baseTerms(NO_ROW, termLine('Start date', '&lt;i&gt;soon&lt;/i&gt;'), NO_ROW));
  });

  it('K-T4: prints the end date as given when it is set, escaped once', async () => {
    const [nullDate, empty, june, laterYear, hostile] = K_T4.endDate;
    expect(termsOf(await documentOf(nullDate))).toBe(baseTerms(NO_ROW, NO_ROW, NO_ROW));
    expect(termsOf(await documentOf(empty))).toBe(baseTerms(NO_ROW, NO_ROW, NO_ROW));
    expect(termsOf(await documentOf(june))).toBe(baseTerms(NO_ROW, NO_ROW, termLine('End date', '2026-06-15')));
    expect(termsOf(await documentOf(laterYear))).toBe(baseTerms(NO_ROW, NO_ROW, termLine('End date', '2027-12-31')));
    expect(termsOf(await documentOf(hostile))).toBe(baseTerms(NO_ROW, NO_ROW, termLine('End date', 'A &amp; B')));
  });

  it('K-T4: prints an empty figure for an advance that is blank', async () => {
    expect(termsOf(await documentOf(K_T4.noAdvance))).toBe(
      [
        '<table class="terms totals">',
        '    <tr><td>Advance %</td><td class="num"></td></tr>',
        '    <tr><td>Retention %</td><td class="num">5.00%</td></tr>',
        NO_ROW,
        NO_ROW,
        NO_ROW,
        '  </table>',
      ].join('\n'),
    );
  });
});

describe('buildContractHtml, the heading, the footer and the number', () => {
  it('K-T5: names the studio once in the heading and once in the footer; only the heading falls back to Metra', async () => {
    const expected: Array<[heading: string, footer: string, name: string | null]> = [
      ['<h1>Metra</h1>', '<div class="footer">Metra · C-2026-0004</div>', 'Metra'],
      ['<h1>Hassan &amp; Sons</h1>', '<div class="footer">Hassan &amp; Sons · C-2026-0004</div>', 'Hassan &amp; Sons'],
      ['<h1>استوديو النيل</h1>', '<div class="footer">استوديو النيل · C-2026-0004</div>', 'استوديو النيل'],
      // No name in either language: the heading falls back, the footer does not.
      ['<h1>Metra</h1>', '<div class="footer"> · C-2026-0004</div>', null],
      ['<h1>Atelier &quot;Nine&quot;</h1>', '<div class="footer">Atelier &quot;Nine&quot; · C-2026-0004</div>', 'Atelier &quot;Nine&quot;'],
      // A name of spaces only is a name: no fallback.
      ['<h1>   </h1>', '<div class="footer">    · C-2026-0004</div>', null],
      ['<h1>   </h1>', '<div class="footer">    · C-2026-0004</div>', null],
      ['<h1>O&#39;Brien &lt;Design&gt;</h1>', '<div class="footer">O&#39;Brien &lt;Design&gt; · C-2026-0004</div>', 'O&#39;Brien &lt;Design&gt;'],
    ];
    expect(K_T5).toHaveLength(expected.length);
    for (const [i, [heading, footer, name]] of expected.entries()) {
      const html = await documentOf(K_T5[i]);
      expect(headingOf(html)).toBe(heading);
      expect(footerOf(html)).toBe(footer);
      if (name !== null) expect(occurrences(html, name)).toBe(2);
    }
  });

  it('K-T6: numbers the contract C-<the creation year in Cairo>-<the number, four digits at least>', async () => {
    const [four, oneTwoThree, fiveDigits] = K_T6.number;
    expect(numberOf(await documentOf(four))).toBe('<strong>C-2026-0004</strong>');
    expect(numberOf(await documentOf(oneTwoThree))).toBe('<strong>C-2026-0123</strong>');
    expect(numberOf(await documentOf(fiveDigits))).toBe('<strong>C-2026-12345</strong>');

    const [march, newYearInCairo, earlier, notADate] = K_T6.createdAt;
    expect(numberOf(await documentOf(march))).toBe('<strong>C-2026-0004</strong>');
    // 22:30 UTC on 31 December 2025 is 00:30 on 1 January 2026 in Cairo.
    expect(numberOf(await documentOf(newYearInCairo))).toBe('<strong>C-2026-0004</strong>');
    expect(numberOf(await documentOf(earlier))).toBe('<strong>C-2024-0004</strong>');
    expect(numberOf(await documentOf(notADate))).toBe('<strong>C-NaN-0004</strong>');
  });

  it('K-T6: never takes the year from the start date', async () => {
    const html = await documentOf(K_T6.startsNextYear);
    expect(numberOf(html)).toBe('<strong>C-2026-0004</strong>');
    expect(footerOf(html)).toBe('<div class="footer">Metra · C-2026-0004</div>');
  });
});

describe('buildContractHtml, the fonts', () => {
  it('K-T7: leaves two spaces on a line of their own when there are none', async () => {
    const outcome = await attempt(K_T7.none);
    expect(outcome.output).toContain('<style>\n  \n  * { box-sizing: border-box; }');
    expect([outcome.fontCalls, outcome.fontArgCount]).toEqual([1, 0]);
  });

  it('K-T7: puts the font faces after those two spaces, first in the style block', async () => {
    const outcome = await attempt(K_T7.embedded);
    expect(outcome.output).toContain(`<style>\n  ${FONT_CSS}\n  * { box-sizing: border-box; }`);
    expect([outcome.fontCalls, outcome.fontArgCount]).toEqual([1, 0]);
  });

  it('K-T8: reads the head, the variant and the revised flag BEFORE the fonts load, and the tables after (en, a)', async () => {
    const html = await documentOf(K_T8.enA);
    // Read before: the language, the studio, the number, the variant, whether the value was revised.
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(headingOf(html)).toBe('<h1>Metra</h1>');
    expect(numberOf(html)).toBe('<strong>C-2026-0004</strong>');
    expect(html).toContain('<th class="num">Cost</th>');
    expect(html).toContain('<th class="num">Margin</th>');
    // Read after: the sections, the amounts, the margin, the terms.
    expect(occurrences(sectionsOf(html), '<tr class="section">')).toBe(1);
    expect(sectionsOf(html)).toContain('<td class="desc">Item 1</td>');
    expect(totalsOf(html)).toBe(
      [
        '<table class="totals">',
        '    <tr><td>Subtotal</td><td class="num">250,000.50 EGP</td></tr>',
        '    <tr><td>Discount</td><td class="num">12,500.25 EGP</td></tr>',
        '    <tr><td>VAT (14.50%)</td><td class="num">33,250.04 EGP</td></tr>',
        '    <tr><td>Supervision (7.25%)</td><td class="num">23,750.02 EGP</td></tr>',
        '    <tr class="grand"><td>Original value</td><td class="num">294,500.81 EGP</td></tr>',
        // No revised row, although the values it became differ: the flag was read before.
        NO_ROW,
        marginRow('12,345.68 EGP'),
        '  </table>',
      ].join('\n'),
    );
    expect(termsOf(html)).toBe(
      [
        '<table class="terms totals">',
        '    <tr><td>Advance %</td><td class="num">10.50%</td></tr>',
        '    <tr><td>Retention %</td><td class="num">2.75%</td></tr>',
        termLine('Payment terms (days)', '45'),
        termLine('Start date', '2027-01-02'),
        termLine('End date', '2027-12-31'),
        '  </table>',
      ].join('\n'),
    );
  });

  it('K-T8: the same split of reads in the reverse change (en, b)', async () => {
    const html = await documentOf(K_T8.enB);
    expect(html).toContain('<html lang="ar-EG" dir="rtl">');
    expect(headingOf(html)).toBe('<h1>Hassan &amp; Sons</h1>');
    expect(numberOf(html)).toBe('<strong>C-2024-0123</strong>');
    // The client variant was read before: no cost column, no margin row, although the input became internal.
    expect(html).not.toContain('التكلفة');
    expect(html).not.toContain('هامش الربح');
    expect(occurrences(sectionsOf(html), '<tr class="section">')).toBe(2);
    // The revised flag was read before (the values differed); the figure after (the base's).
    expect(totalsOf(html)).toContain('<tr class="grand"><td>القيمة بعد التعديلات</td><td class="num">1,240.00 ج.م</td></tr>');
    expect(totalsOf(html)).toContain('<td class="num">1,000.00 ج.م</td>');
    expect(termsOf(html)).toContain('<td class="num">25.00%</td>');
    expect(termsOf(html)).toContain('<td class="num">2026-06-15</td>');
  });

  it('K-T8: the same split of reads starting in Arabic (ar-EG, a and b)', async () => {
    const a = await documentOf(K_T8.arA);
    expect(a).toContain('<html lang="ar-EG" dir="rtl">');
    expect(headingOf(a)).toBe('<h1>ميترا</h1>');
    expect(numberOf(a)).toBe('<strong>C-2026-0004</strong>');
    expect(a).toContain('<th class="num">التكلفة</th>');
    expect(occurrences(sectionsOf(a), '<tr class="section">')).toBe(1);
    expect(totalsOf(a)).toContain('<td class="num">294,500.81 ج.م</td>');
    expect(totalsOf(a)).not.toContain('القيمة بعد التعديلات');
    expect(totalsOf(a)).toContain('<tr><td>هامش الربح</td><td class="num">12,345.68 ج.م</td></tr>');
    expect(termsOf(a)).toContain('<td class="num">2027-12-31</td>');

    const b = await documentOf(K_T8.arB);
    expect(b).toContain('<html lang="en" dir="ltr">');
    expect(headingOf(b)).toBe('<h1>Hassan &amp; Sons</h1>');
    expect(numberOf(b)).toBe('<strong>C-2024-0123</strong>');
    expect(b).not.toContain('Cost');
    expect(b).not.toContain('Margin');
    expect(occurrences(sectionsOf(b), '<tr class="section">')).toBe(2);
    expect(totalsOf(b)).toContain('<tr class="grand"><td>Revised value</td><td class="num">1,240.00 EGP</td></tr>');
    expect(termsOf(b)).toContain('<td class="num">2026-06-15</td>');
  });
});

describe('buildContractHtml, bad input', () => {
  it('K-T9: rejects before the fonts are asked for when the detail or the options cannot be read', async () => {
    const before: Array<[run: Run, message: RegExp]> = [
      [K_T9.detailNull, /reading 'number'/],
      [K_T9.detailUndefined, /reading 'number'/],
      [K_T9.optsUndefined, /'locale' of 'opts'/],
      [K_T9.optsNull, /'locale' of 'opts'/],
      [K_T9.localeUndefined, /startsWith/],
      [K_T9.localeNumber, /startsWith/],
      [K_T9.optsEmpty, /startsWith/],
    ];
    for (const [run, message] of before) {
      const outcome = await attempt(run);
      expect([run.id, outcome.output, outcome.fontCalls]).toEqual([run.id, 'THROWN TypeError', 0]);
      expect((outcome.error as Error).message).toMatch(message);
    }
  });

  it('K-T9: rejects after the fonts were asked for once when a table cannot be built', async () => {
    const after: Array<[run: Run, thrown: string]> = [
      [K_T9.sectionsUndefined, 'THROWN TypeError'],
      [K_T9.sectionsNull, 'THROWN TypeError'],
      [K_T9.linesUndefined, 'THROWN TypeError'],
      [K_T9.detailEmpty, 'THROWN TypeError'],
      [K_T9.localeInvalid, 'THROWN RangeError'],
      [K_T9.startDateNumber, 'THROWN TypeError'],
    ];
    for (const [run, thrown] of after) {
      const outcome = await attempt(run);
      expect([run.id, outcome.output, outcome.fontCalls]).toEqual([run.id, thrown, 1]);
    }
  });

  it('K-T9: resolves on a variant it does not know (the client layout), a missing number, numbers for amounts and a null amount', async () => {
    const uppercase = await documentOf(K_T9.variantUppercase);
    expect(uppercase).not.toContain('Cost');
    expect(uppercase).toBe(await documentOf(K_T1));

    expect(numberOf(await documentOf(K_T9.numberUndefined))).toBe('<strong>C-2026-undefined</strong>');

    const numbers = await documentOf(K_T9.amountsAsNumbers);
    expect(totalsOf(numbers)).toBe(baseTotals(NO_ROW, NO_ROW));
    expect(termsOf(numbers)).toBe(baseTerms(NO_ROW, NO_ROW, NO_ROW));

    expect(totalsOf(await documentOf(K_T9.subtotalNull))).toContain('    <tr><td>Subtotal</td><td class="num"></td></tr>\n');
  });
});
