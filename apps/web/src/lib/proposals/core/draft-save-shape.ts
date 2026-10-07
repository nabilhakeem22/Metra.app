// Stage 0 of the draft save: is the payload even SHAPED like a draft? A server
// action accepts any JSON, so a field the type promises to be a string can arrive
// as an object, and `.trim()` on it would throw a TypeError deep in the resolver
// (answered `generic`, with a false defect in the log). PURE: a wrong shape is
// refused `invalid` at the boundary, before any transaction opens.
import { isRevisionToken } from '../revision';
import type { SaveDraftInput } from './types';

const LINE_TEXT_FIELDS = [
  'id',
  'costItemId',
  'descriptionAr',
  'descriptionEn',
  'qty',
  'unit',
  'unitCost',
  'unitPrice',
  'discountPct',
] as const;

const HEADER_TEXT_FIELDS = [
  'titleAr',
  'titleEn',
  'issueDate',
  'expiryDate',
  'discountPct',
  'taxRate',
  'supervisionPct',
  'currency',
  'notesAr',
  'notesEn',
  'termsAr',
  'termsEn',
] as const;

type Shape = Record<string, unknown>;

const isObject = (value: unknown): value is Shape =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Absent, null, or a string. */
const isOptionalText = (value: unknown) =>
  value === undefined || value === null || typeof value === 'string';

const isOptionalOrder = (value: unknown) =>
  value === undefined || (typeof value === 'number' && Number.isFinite(value));

function isLineShape(line: unknown): boolean {
  return (
    isObject(line) &&
    LINE_TEXT_FIELDS.every((field) => isOptionalText(line[field])) &&
    isOptionalOrder(line.sortOrder)
  );
}

function isSectionShape(section: unknown): boolean {
  return (
    isObject(section) &&
    isOptionalText(section.id) &&
    isOptionalText(section.titleAr) &&
    isOptionalText(section.titleEn) &&
    isOptionalOrder(section.sortOrder) &&
    Array.isArray(section.lines) &&
    section.lines.every(isLineShape)
  );
}

/** True when `input` has the SaveDraftInput shape, every field its declared type. */
export function isSaveDraftInputShape(input: unknown): input is SaveDraftInput {
  if (!isObject(input) || typeof input.id !== 'string') return false;
  if (input.revision !== undefined && !isRevisionToken(input.revision)) return false;
  if (input.header !== undefined) {
    const header = input.header;
    if (!isObject(header) || !HEADER_TEXT_FIELDS.every((field) => isOptionalText(header[field]))) {
      return false;
    }
  }
  return Array.isArray(input.sections) && input.sections.every(isSectionShape);
}
