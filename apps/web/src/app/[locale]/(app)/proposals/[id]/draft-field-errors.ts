// The builder's refusals, keyed by ROW so they stay on their cell however the
// rows move. PURE and client-safe.
//
// The server answers by POSITION in the draft it was sent (`sections.<s>.name`,
// `lines.<s>.<l>.<cell>`, draft-save-resolve.ts); `keyedDraftErrors` turns each
// position into the key of the row that was there, using that same sent draft.
// The header's three percentages keep their own names.
import type { FieldError, FieldErrors } from '@/lib/actions/field-errors';
import { isValidMoneyInput } from '@/lib/aggregates/proposal-totals';
import { figureOf, type SectionState } from './builder-model';
import type { LineFigure } from './draft-completeness';

/** The cells of a line a refusal can sit under. */
export type LineCell = 'description' | 'unit' | LineFigure;

export const linePath = (lineKey: string, cell: LineCell) => `lines.${lineKey}.${cell}`;
export const sectionPath = (sectionKey: string) => `sections.${sectionKey}.name`;

const SECTION_AT = /^sections\.(\d+)\.name$/;
const LINE_AT = /^lines\.(\d+)\.(\d+)\.([A-Za-z]+)$/;

/** The server's positional paths as row-keyed ones; a position the sent draft
 *  does not have stays as it came (the builder says it above the sections). */
export function keyedDraftErrors(sent: readonly SectionState[], fields: FieldErrors): FieldErrors {
  const keyed: Record<string, FieldError> = {};
  for (const [path, error] of Object.entries(fields)) {
    if (!error) continue;
    const section = SECTION_AT.exec(path);
    const line = LINE_AT.exec(path);
    const sectionKey = section ? sent[Number(section[1])]?.key : undefined;
    const lineKey = line ? sent[Number(line[1])]?.lines[Number(line[2])]?.key : undefined;
    if (sectionKey) keyed[sectionPath(sectionKey)] = error;
    else if (lineKey && line) keyed[linePath(lineKey, line[3] as LineCell)] = error;
    else keyed[path] = error;
  }
  return keyed;
}

const FIGURES: readonly LineFigure[] = ['qty', 'unitCost', 'unitPrice', 'discountPct'];
const blank = (value: string) => value.trim() === '';

/**
 * Every field that would make the server refuse the save, said the way the
 * server would: a section with no name, a line with no description, a figure
 * that does not read. What Send shows when the draft cannot go yet (D1).
 */
export function incompleteDraftErrors(sections: readonly SectionState[]): FieldErrors {
  const errors: Record<string, FieldError> = {};
  for (const section of sections) {
    if (blank(section.titleEn) && blank(section.titleAr)) {
      errors[sectionPath(section.key)] = { code: 'name_required' };
    }
    for (const line of section.lines) {
      if (!line.costItemId && blank(line.descriptionEn) && blank(line.descriptionAr)) {
        errors[linePath(line.key, 'description')] = { code: 'line_required' };
      }
      for (const figure of FIGURES) {
        if (!blank(line[figure]) && !isValidMoneyInput(figureOf(line[figure]))) {
          errors[linePath(line.key, figure)] = { code: 'not_a_number' };
        }
      }
    }
  }
  return errors;
}
