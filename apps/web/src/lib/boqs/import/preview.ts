/**
 * The BOQ import preview, as a PURE function of the uploaded text.
 *
 * Lifted out of the `'use server'` module so the caps below can be tested
 * directly — a hostile sheet is exactly the input one wants to assert on without
 * a session, and the action wrapper's only remaining job is `requireOrg()`.
 */
import { fieldsFailed } from '@/lib/actions/field-errors';
import { err, type ActionCode, type ActionResult } from '@/lib/actions/result';
import { decodeCsv, type DecodeNote } from './decode';
import {
  autoDetectMapping,
  mapRows,
  type BoqImportRowIssue,
  type ImportedLine,
} from './map';
import {
  ImportParseError,
  MAX_IMPORT_BYTES,
  type ImportParseReason,
} from '@/lib/import/limits';

/** The preview, or why the FILE cannot be read, said under the file box
 *  (`fields.file`) by its cause rather than one blanket "could not read that". */
export interface ImportPreview extends ActionResult {
  /** Lines that would be created. */
  lines?: ImportedLine[];
  /** Row number + coded reasons for everything that would not. */
  problems?: { rowNumber: number; issues: BoqImportRowIssue[] }[];
  notes?: DecodeNote[];
}

/**
 * A parse refusal as the preview's error code. Every ceiling answers with the
 * code the price-book path already uses, so "too big" reads the same whichever
 * importer the studio went through.
 */
function previewErrorFor(reason: ImportParseReason): ActionCode {
  if (reason === 'empty') return 'import_empty';
  return reason === 'unreadable' ? 'import_unreadable' : 'import_too_large';
}

/** A refusal of the uploaded file itself. */
const fileRefused = (code: ActionCode): ImportPreview => fieldsFailed({ file: { code } });

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
  if (typeof csvText !== 'string') return err('malformed');
  if (csvText.length > MAX_IMPORT_BYTES) return fileRefused('import_too_large');
  if (csvText.trim() === '') return fileRefused('import_empty');

  let decoded;
  try {
    decoded = decodeCsv(csvText);
  } catch (cause) {
    // The parser's own ceilings (raw rows, cells) reach the studio as a coded
    // refusal rather than a rejected server action, which the page could only
    // show as its generic failure toast.
    if (cause instanceof ImportParseError) {
      return fileRefused(previewErrorFor(cause.reason));
    }
    throw cause;
  }
  const header = decoded.grid.rows[0];
  if (!header) return fileRefused('import_empty');

  const result = mapRows(decoded.grid, autoDetectMapping(header));
  return {
    ok: true,
    lines: result.ok,
    problems: result.rows
      .filter((r) => r.issues.length > 0)
      .map((r) => ({ rowNumber: r.rowNumber, issues: r.issues })),
    notes: decoded.notes,
  };
}
