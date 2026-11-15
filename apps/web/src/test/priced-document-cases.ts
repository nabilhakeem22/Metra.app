// TEST-ONLY. The fixture data the two priced-PDF characterizations share
// (lib/pdf/contract-template and lib/pdf/proposal-template): the section and
// money sets a document is built from, and the pool of values each shared input
// is swept through. No logic beyond building rows. No amount is negative: ar-EG
// puts a bidi mark before a minus sign, and that is the one figure that could
// differ between two runtimes' ICU data.

/** A pool value that means "leave the key OFF the object", as distinct from a key present with `undefined`. */
export const ABSENT = Symbol('absent');

/** A stand-in for the embedded @font-face block: two lines, so where the fonts land shows. */
export const FONT_CSS =
  "@font-face { font-family: 'Cairo'; font-weight: 400 900;\n    src: url(data:font/ttf;base64,QUJD) format('truetype'); }";

type Row = Record<string, unknown>;

const line = (n: number, over: Row = {}): Row => ({
  id: 'l' + n,
  descriptionAr: 'بند ' + n,
  descriptionEn: 'Item ' + n,
  costItemId: null,
  qty: String(n * 2.5),
  unit: n % 2 ? 'm2' : 'pcs',
  unitPrice: String(100 * n + 0.5),
  discountPct: n % 2 ? '0' : '5',
  lineTotal: String(250 * n + 1.25),
  sortOrder: n,
  ...over,
});

const section = (n: number, lines: Row[], over: Row = {}): Row => ({
  id: 's' + n,
  titleAr: 'قسم ' + n,
  titleEn: 'Section ' + n,
  sortOrder: n,
  sectionSubtotal: String(1000 * n + 0.75),
  lines,
  ...over,
});

/** Factories, so every case gets rows of its own. */
export const SECTION_SETS = {
  oneOne: () => [section(1, [line(1)])],
  none: () => [],
  oneEmpty: () => [section(1, [])],
  twoThree: () => [
    section(1, [
      line(1, { unitCost: '60', lineCost: '150', lineMargin: '101.25' }),
      line(2, { unitCost: '120.5', lineMargin: '199' }),
    ]),
    section(2, [line(3)]),
  ],
  hostile: () => [
    section(1, [line(1, { descriptionAr: null, descriptionEn: '<img src=x> & "q" \'s\'', unit: '<u>' })], {
      titleAr: '',
      titleEn: null,
    }),
  ],
} satisfies Record<string, () => Row[]>;

export const MONEY_SETS = {
  a: { subtotal: '1000', discountAmount: '0', taxAmount: '140', supervisionAmount: '100' },
  b: { subtotal: '250000.5', discountAmount: '12500.25', taxAmount: '33250.035', supervisionAmount: '23750.0238' },
  zero: { subtotal: '0', discountAmount: '0', taxAmount: '0', supervisionAmount: '0' },
  odd: { subtotal: '', discountAmount: 'abc', taxAmount: ' ', supervisionAmount: '12.5' },
};

/** A bilingual name: [Arabic, English]. */
type NamePair = readonly [arabic: string | null, english: string | null];

/** The inputs both priced documents take. The FIRST value of each pool is the base. */
export const PRICED_POOLS = {
  locale: ['en', 'ar-EG'],
  variant: ['client', 'internal'],
  org: [
    ['ميترا', 'Metra'],
    [null, 'Hassan & Sons'],
    ['استوديو النيل', null],
    [null, null],
    ['', 'Atelier "Nine"'],
    ['   ', null],
    ['   ', '  '],
    ['<b>س</b>', "O'Brien <Design>"],
  ] as NamePair[],
  client: [['أكمي', 'Acme Interiors'], [null, 'Rehab & Co'], ['شركة الرحاب', null], [null, null], ['', '']] as NamePair[],
  title: [['عقد تشطيب', 'Fit-out contract'], [null, 'Villa "A" <phase 2>'], ['تشطيب فيلا', ''], [null, null]] as NamePair[],
  number: [4, 123, 12345],
  createdAt: ['2026-03-10T00:00:00.000Z', '2025-12-31T22:30:00.000Z', '2024-06-01T09:00:00.000Z', 'not a date'],
  money: ['a', 'b', 'zero', 'odd'] as (keyof typeof MONEY_SETS)[],
  taxRate: ['14', '0', '14.5', ''],
  supervisionPct: ['10', '0', '7.25', ''],
  /** The contract's `originalValue`; the proposal's `total`. */
  grand: ['1240', '294500.8088', '0'],
  totalMargin: [ABSENT, undefined, '300', '0', '', '12345.678', null],
  sections: ['oneOne', 'none', 'oneEmpty', 'twoThree', 'hostile'] as (keyof typeof SECTION_SETS)[],
  fonts: ['', FONT_CSS],
};
