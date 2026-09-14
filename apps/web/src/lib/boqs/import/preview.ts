/**
 * The BOQ import preview, as a PURE function of the uploaded text.
 *
 * Lifted out of the `'use server'` module so the caps below can be tested
 * directly — a hostile sheet is exactly the input one wants to assert on without
 * a session, and the action wrapper's only remaining job is `requireOrg()`.
 */
import { decodeCsv } from './decode';
import { autoDetectMapping, mapRows, type ImportedLine } from './map';
import {
  ImportParseError,
  MAX_IMPORT_BYTES,
  type ImportParseReason,
} from '@/lib/import/limits';

export interface ImportPreview {
  ok: boolean;
  error?: string;
  /** Lines that would be created. */
  lines?: ImportedLine[];
  /** Row number + reason for everything that would not. */
  problems?: { rowNumber: number; errors: string[] }[];
  notes?: string[];
}

/**
 * A parse refusal as the preview's error code. Every ceiling answers with the
 * code the price-book path already uses, so "too big" reads the same whichever
 * importer the studio went through.
 */
function previewErrorFor(reason: ImportParseReason): string {
  return reason === 'empty' || reason === 'unreadable'
    ? 'invalid'
    : 'import_too_large';
}

/**
 * Decode and validate an uploaded sheet WITHOUT writing anything.
 *
 * The preview is the safety net for the whole import: it is where the studio
 * sees the template's own example row still sitting in their file, spots a
 * column that mapped to the wrong field, and finds the eight rows with a unit
 * Metra does not have — all before a single line exists.
 *
 * THE SIZE CHECK COMES FIRST, before anything reads the string. The uploader
 * hands over whatever `file.text()` produced, so until now the only bound on a
 * BOQ preview was the request body limit: the price-book path checked
 * MAX_IMPORT_BYTES on its upload and this one checked nothing at all. `length` is
 * UTF-16 units rather than bytes, which UNDER-counts a non-ASCII file and so only
 * ever refuses later than a byte cap would — the safe direction for a fence. It
 * also has to precede the `trim()`, which would otherwise copy the whole 5 MiB
 * just to ask whether it is blank.
 */
export function previewBoqImportText(csvText: string): ImportPreview {
  if (typeof csvText !== 'string') return { ok: false, error: 'invalid' };
  if (csvText.length > MAX_IMPORT_BYTES) {
    return { ok: false, error: 'import_too_large' };
  }
  if (csvText.trim() === '') return { ok: false, error: 'invalid' };

  let decoded;
  try {
    decoded = decodeCsv(csvText);
  } catch (cause) {
    // The parser's own ceilings (raw rows, cells) reach the studio as a coded
    // refusal rather than a rejected server action, which the page could only
    // show as its generic failure toast.
    if (cause instanceof ImportParseError) {
      return { ok: false, error: previewErrorFor(cause.reason) };
    }
    throw cause;
  }
  const header = decoded.grid.rows[0];
  if (!header) return { ok: false, error: 'invalid' };

  const result = mapRows(decoded.grid, autoDetectMapping(header));
  return {
    ok: true,
    lines: result.ok,
    problems: result.rows
      .filter((r) => r.errors.length > 0)
      .map((r) => ({ rowNumber: r.rowNumber, errors: r.errors })),
    notes: decoded.notes,
  };
}
