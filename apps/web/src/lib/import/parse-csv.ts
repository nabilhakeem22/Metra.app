/**
 * The ONE CSV parser. Hand-rolled rather than a dependency — the repo holds a
 * no-new-dependency fence and this is the whole of what is needed.
 *
 * PURE and CLIENT-SAFE (no `server-only`): the BOQ preview decodes in the
 * browser before anything is uploaded.
 *
 * There were two of these and they disagreed about the double quote. One opened
 * quote mode on ANY `"`, so `3" pipe` — an inch mark, which a fit-out BOQ is
 * full of — swallowed the rest of the file into a single field and the import
 * silently lost every row after it. The other only opened on a `"` at the START
 * of a field, which is the rule that reads a real sheet correctly. That rule is
 * the one kept here.
 */
import { ImportParseError, MAX_IMPORT_CELLS, MAX_RAW_ROWS } from './limits';

export interface ParseCsvOptions {
  /** Sniffed by the decoder; defaults to a comma. */
  delimiter?: string;
  /** Raw-row ceiling; bails with too_many_rows rather than building the matrix. */
  maxRows?: number;
}

/**
 * RFC-4180-shaped rows. Quoted fields may contain the delimiter, newlines and
 * doubled quotes; CRLF, LF and a lone CR all terminate a row; every field is
 * trimmed.
 *
 * THE QUOTE RULE, stated once: a `"` opens a quoted field ONLY as that field's
 * first character. Anywhere else it is a literal — so `3" pipe` stays `3" pipe`.
 * Inside a quoted field `""` is an escaped quote and a lone `"` closes it;
 * characters between a closing quote and the delimiter are appended literally,
 * which is lenient on purpose, because a studio's sheet is not a spec document.
 */
export function parseCsvRows(text: string, options: ParseCsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ',';
  const maxRows = options.maxRows ?? MAX_RAW_ROWS;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // True once THIS field has opened a quote, so a later `"` (after the close) is
  // a literal rather than a re-open.
  let fieldWasQuoted = false;

  // Counted per FIELD, because the row cap bounds height only: 1 MiB of commas
  // is ONE row of a million fields and never reaches maxRows.
  let cells = 0;

  const pushField = () => {
    row.push(field.trim());
    field = '';
    fieldWasQuoted = false;
    cells += 1;
    if (cells > MAX_IMPORT_CELLS) throw new ImportParseError('too_many_cells');
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
    if (rows.length > maxRows) throw new ImportParseError('too_many_rows');
  };

  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (inQuotes) {
      if (character !== '"') {
        field += character;
      } else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = false;
      }
      continue;
    }
    if (character === '"' && field === '' && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (character === delimiter) {
      pushField();
    } else if (character === '\n') {
      pushRow();
    } else if (character === '\r') {
      pushRow();
      if (text[i + 1] === '\n') i += 1; // swallow the LF of a CRLF pair
    } else {
      field += character; // including a mid-field `"`
    }
  }
  // A file that does not end in a newline still has a final row.
  if (field !== '' || row.length > 0) pushRow();

  return rows;
}
