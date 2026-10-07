// Is the draft complete enough to save? PURE and CLIENT-SAFE.
//
// The server refuses the WHOLE save for one unnamed section or one line without a
// description or with a figure it cannot read. A blank line the studio has just
// added is not an error, it is work in progress: the autosave waits for it rather
// than flashing "Not saved", and Send names the first field still missing.
import { isValidMoneyInput } from '@/lib/aggregates/proposal-totals';
import { figureOf, type SectionState } from './builder-model';

export type LineFigure = 'qty' | 'unitCost' | 'unitPrice' | 'discountPct';

export type DraftField =
  | { kind: 'sectionTitle'; sectionIndex: number }
  | { kind: 'line'; sectionIndex: number; lineIndex: number; input: 'description' | LineFigure };

const FIGURES: readonly LineFigure[] = ['qty', 'unitCost', 'unitPrice', 'discountPct'];

const blank = (value: string) => value.trim() === '';

/** A figure the save would send: empty (read as 0) or a number the server reads. */
const readable = (value: string) => blank(value) || isValidMoneyInput(figureOf(value));

/** The first field that would make the server refuse the save, or null. */
export function firstIncompleteField(sections: readonly SectionState[]): DraftField | null {
  for (const [sectionIndex, section] of sections.entries()) {
    if (blank(section.titleEn) && blank(section.titleAr)) return { kind: 'sectionTitle', sectionIndex };
    for (const [lineIndex, line] of section.lines.entries()) {
      if (!line.costItemId && blank(line.descriptionEn) && blank(line.descriptionAr)) {
        return { kind: 'line', sectionIndex, lineIndex, input: 'description' };
      }
      const unreadable = FIGURES.find((figure) => !readable(line[figure]));
      if (unreadable) return { kind: 'line', sectionIndex, lineIndex, input: unreadable };
    }
  }
  return null;
}

/** The CSS selector of the control for `field` (the data attributes the builder renders). */
export function draftFieldSelector(field: DraftField): string {
  return field.kind === 'sectionTitle'
    ? `[data-draft-section="${field.sectionIndex}"] input`
    : `[data-draft-line="${field.sectionIndex}-${field.lineIndex}"] [data-draft-input="${field.input}"]`;
}
