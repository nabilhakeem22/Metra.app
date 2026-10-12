// The differential corpus for migrations 0059 and 0060 (AC C4, K4): inputs a
// studio could type or paste into the Settings card. Not a test file. Every value is built
// from code points, so no invisible character hides in this source.

const cp = (...points: number[]) => String.fromCodePoint(...points);
const RLM = cp(0x200f);
const LRM = cp(0x200e);

/** The w3a F2 pastes, the normaliser's own phone cases, and the double trunk zero after +20. */
export const NAMED_PHONES = [
  '+20 (0)10 1234 5678', '+20 010 1234 5678', '00 20 0 10 1234 5678', '+0020 10 1234 5678', '+0000000',
  '010 1234 5678', cp(0x660, 0x661, 0x660, 0x661, 0x662, 0x663, 0x664, 0x665, 0x666, 0x667, 0x668),
  '1012345678', '02 2345 6789', '040 123 4567', '+20 10-1234-5678', '0020 (10) 1234.5678',
  `${RLM}+20 10 1234 5678${LRM}`, '+44 20 7946 0958', '12', '123456', '1234567', '+1234567890123456',
  '010 1234 567x', '20+1012345678', '++201012345678', '19999',
  '+20 00 1012345678', '0020 00 10 1234 5678', '+20 0 0 12345678', '+200012345678', '+2001012345678',
  // Round E (0060, K4): the trunk zeros the +200 CHECK refuses, as people type them.
  '+20 00 10 1234 5678', '+20 000 1012345678', '0020 0 10 1234 5678', '+200 10 1234 5678',
];

/** The w3a F8 values and ordinary studio text, Arabic with its marks included. */
export const NAMED_TEXTS = [
  `CIB${cp(0)}`, `ab${cp(1)}`, `ab${cp(9)}cd`, `ab${cp(0x7f)}`, cp(0x85, 0x85, 0x85), `ab${cp(0x9b)}`,
  `a${String.fromCharCode(0xd800)}b`, cp(0x2800, 0x2800), cp(0x115f, 0x115f), cp(0xffa0, 0xffa0, 0xffa0),
  cp(0x651, 0x651, 0x651), cp(0x2800, 0x61), `x${cp(0x651)}`, 'CIB', 'بنك مصر', 'studio@instapay',
  'مُحَمَّد علي', `${RLM}البنك الأهلي المصري${cp(0x61c)} `, `${cp(0xa0, 0x200b)}ستوديو ٧${LRM}`,
  ` studio${cp(0xad, 0x200b)}@instapay `, cp(0x1f600).repeat(60), 'ب'.repeat(120), ' x ',
  // Round D review (F2, L3): selectors, fillers, private use and noncharacters, alone and with a letter.
  cp(0xfe0f, 0xfe0f), cp(0x17b4, 0x17b5), cp(0x34f, 0x13440), cp(0xe0100, 0xe0100), cp(0x180b, 0x180f),
  cp(0x16fe4, 0x16fe4), cp(0xe000, 0xe000), cp(0xffff, 0xffff), cp(0xfffc, 0xfffc), `CIB${cp(0xfe0f)}`, `CIB${cp(0xe000)}`,
  // Round E (0060, K4): the musical null notehead beside a letter, and the line separators at the edges.
  `CIB${cp(0x1d159)}`, `${cp(0x2028)}CIB`, `CIB${cp(0x2028)}`, `${cp(0x2029)}CIB${cp(0x2028)}`,
  // Round E (S3): the unassigned default-ignorables, alone and beside a letter.
  cp(0xfff0, 0xfff8), cp(0xe0002, 0xe0080), cp(0xe01f0, 0xe0fff), `CIB${cp(0xe0002)}`, `CIB${cp(0xfff0)}`,
];

/** A seeded generator (mulberry32), so a failing case is reproducible from its seed. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inclusive code point ranges: the ordinary, the invisible, and the edges of NOT_VISIBLE. */
const TEXT_RANGES: Array<[number, number]> = [
  [0x61, 0x7a], [0x30, 0x39], [0x21, 0x2f], [0x621, 0x64a], [0x660, 0x669], // letters, digits, punctuation, Arabic
  [0x64b, 0x65f], [0x670, 0x670], [0x6d6, 0x6ed], [0x300, 0x36f], [0x1ab0, 0x1aff], [0x20d0, 0x20ff], // marks and their edges
  [0x20, 0x20], [0xa0, 0xa0], [0x2000, 0x200f], [0x2028, 0x202f], [0x205f, 0x206f], [0x3000, 0x3000], [0xfeff, 0xfeff],
  [0x1, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x600, 0x61c], // controls and format characters
  [0x2800, 0x2801], [0x115f, 0x1160], [0x3164, 0x3164], [0xffa0, 0xffa1], [0xfe20, 0xfe2f], [0x1dc0, 0x1dff],
  [0x1f600, 0x1f64f], [0x4e00, 0x4e20], [0xac00, 0xac20], [0x10000, 0x1007f], [0xe0001, 0xe007f],
  [0xfe00, 0xfe0f], [0xe0100, 0xe01ef], [0x17b4, 0x17b5], [0x180b, 0x180f], [0xe000, 0xe0ff], [0xfdd0, 0xfdef], [0xfffc, 0xffff],
];

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

/** `count` random strings of 1 to 12 characters from TEXT_RANGES. */
export function randomTexts(count: number, seed: number): string[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => {
    const length = 1 + Math.floor(random() * 12);
    return Array.from({ length }, () => {
      const [first, last] = pick(random, TEXT_RANGES);
      return cp(first + Math.floor(random() * (last - first + 1)));
    }).join('');
  });
}

/** How a number starts: international, Egyptian national, and the trunk zeros people keep after +20. */
const PHONE_PREFIXES = ['+', '00', '+00', '', '0', '01', '02', '+20', '0020', '+20 0', '+20 00', '+20 (0)', '0020 0', '+44 ', '+1 ', '+0'];

/** What people type between digits, and the marks a paste carries. */
const PHONE_SEPARATORS = ['', '', '', '', ' ', '-', '.', '(', ')', '/', cp(0xa0), RLM, LRM];

/** A digit as typed: Latin, Arabic-Indic or Persian. */
function typedDigit(random: () => number): string {
  const digit = Math.floor(random() * 10);
  const script = random();
  if (script < 0.8) return String(digit);
  return cp((script < 0.9 ? 0x660 : 0x6f0) + digit);
}

/** `count` random phone-shaped strings: a prefix, then 6 to 14 digits with separators. */
export function randomPhones(count: number, seed: number): string[] {
  const random = seededRandom(seed);
  return Array.from({ length: count }, () => {
    const digits = 6 + Math.floor(random() * 9);
    const body = Array.from({ length: digits }, () => pick(random, PHONE_SEPARATORS) + typedDigit(random)).join('');
    return `${pick(random, PHONE_PREFIXES)}${body}`;
  });
}
