// A roll's pack size, read off its printed unit label. Different roll lengths
// are different items, so the pack is part of the item's identity (B6). The
// bulletin prints it several ways, all of them seen in July 2026:
//   «اللفة (100 م.ط)»  «اللفة (30 متر)»  «اللفة 45 متر)» (no opening bracket)
//   «لفة 34×3م»  «لفة 15×3متر»  «لفة عدد 34 ماسورة بطول 3 متر»
import { normalizeArabic, type RollPack } from '@metra/db/market-seed';

// The pack's shape is the seed's too (a roll is named with it), so it is declared once there.
export type { RollPack };

const ROLL_WORD = /^(ال)?لفه\s*/;
const METRE = '(?:م\\.ط|مط|متر طولي|متر|م)';
const NUMBER = '([0-9]+(?:\\.[0-9]+)?)';
const LENGTH_ONLY = new RegExp(`^${NUMBER}\\s*${METRE}$`);
const PIECES_BY_LENGTH = new RegExp(`^${NUMBER}\\s*[x×*]\\s*${NUMBER}\\s*${METRE}?$`);
const PIECES_SPELLED = new RegExp(`^عدد\\s*${NUMBER}\\s*ماسوره\\s*بطول\\s*${NUMBER}\\s*${METRE}?$`);

/** The pack of a roll label, or null when the label is not a roll WITH a readable size. */
export function parseRollPack(unitLabelAr: string): RollPack | null {
  const text = normalizeArabic(unitLabelAr).replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!ROLL_WORD.test(text)) return null;
  const size = text.replace(ROLL_WORD, '').trim();
  const length = LENGTH_ONLY.exec(size);
  if (length) return { lengthM: Number(length[1]), pieces: null, pieceLengthM: null };
  const bundle = PIECES_BY_LENGTH.exec(size) ?? PIECES_SPELLED.exec(size);
  if (bundle) return { lengthM: null, pieces: Number(bundle[1]), pieceLengthM: Number(bundle[2]) };
  return null;
}

/** Whether a word for roll opens the label, sized or not (to name the B3 problem precisely). */
export function looksLikeRoll(unitLabelAr: string): boolean {
  return ROLL_WORD.test(normalizeArabic(unitLabelAr).replace(/[()]/g, ' ').trim());
}

export function samePack(a: RollPack | null, b: RollPack | null): boolean {
  if (a === null || b === null) return a === b;
  return a.lengthM === b.lengthM && a.pieces === b.pieces && a.pieceLengthM === b.pieceLengthM;
}

/** '100 m', '34 x 3 m': for messages and review.html. */
export function describePack(pack: RollPack | null): string {
  if (pack === null) return 'no pack';
  return pack.lengthM !== null ? `${pack.lengthM} m` : `${pack.pieces} x ${pack.pieceLengthM} m`;
}
