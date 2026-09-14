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
 * A parse in progress: the rows closed so far, the row and field being built,
 * and whether we are inside a quoted field.
 *
 * Mutable and passed by reference on purpose — this is a character loop, and the
 * alternative (a new state object per character) allocates once per byte of a
 * five-megabyte upload. It is one object, in one module, read by three functions.
 */
interface ParseState {
  rows: string[][];
  row: string[];
  field: string;
  inQuotes: boolean;
  /** True once THIS field has opened a quote, so a later `"` (after the close)
   *  is a literal rather than a re-open. */
  fieldWasQuoted: boolean;
  /** Fields closed so far, across every row — the width half of the ceiling. */
  cells: number;
  maxRows: number;
}

/** Close the current field. Counted per FIELD, because the row cap bounds height
 *  only: 1 MiB of commas is ONE row of a million fields. */
function closeField(state: ParseState): void {
  state.row.push(state.field.trim());
  state.field = '';
  state.fieldWasQuoted = false;
  state.cells += 1;
  if (state.cells > MAX_IMPORT_CELLS) throw new ImportParseError('too_many_cells');
}

/** Close the current row, which closes its last field. */
function closeRow(state: ParseState): void {
  closeField(state);
  state.rows.push(state.row);
  state.row = [];
  if (state.rows.length > state.maxRows) throw new ImportParseError('too_many_rows');
}

/**
 * One character INSIDE a quoted field. Returns how many EXTRA characters it
 * consumed, so the driver can skip the second half of an escaped `""`.
 *
 * `""` is an escaped quote; a lone `"` closes the field. Everything else,
 * including a newline, is content — which is the whole reason quoting exists.
 */
function readQuoted(
  state: ParseState,
  character: string,
  next: string | undefined,
): number {
  if (character !== '"') {
    state.field += character;
    return 0;
  }
  if (next === '"') {
    state.field += '"';
    return 1;
  }
  state.inQuotes = false;
  return 0;
}

/**
 * One character OUTSIDE quotes. Returns how many EXTRA characters it consumed,
 * so the driver can swallow the LF of a CRLF pair.
 *
 * THE QUOTE RULE, stated once: a `"` opens a quoted field ONLY as that field's
 * first character. Anywhere else it is a literal — so `3" pipe` stays `3" pipe`.
 */
function readUnquoted(
  state: ParseState,
  character: string,
  next: string | undefined,
  delimiter: string,
): number {
  if (character === '"' && state.field === '' && !state.fieldWasQuoted) {
    state.inQuotes = true;
    state.fieldWasQuoted = true;
  } else if (character === delimiter) {
    closeField(state);
  } else if (character === '\n') {
    closeRow(state);
  } else if (character === '\r') {
    closeRow(state);
    return next === '\n' ? 1 : 0; // swallow the LF of a CRLF pair
  } else {
    state.field += character; // including a mid-field `"`
  }
  return 0;
}

/**
 * RFC-4180-shaped rows. Quoted fields may contain the delimiter, newlines and
 * doubled quotes; CRLF, LF and a lone CR all terminate a row; every field is
 * trimmed. Characters between a closing quote and the delimiter are appended
 * literally, which is lenient on purpose, because a studio's sheet is not a spec
 * document.
 */
export function parseCsvRows(text: string, options: ParseCsvOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ',';
  const state: ParseState = {
    rows: [],
    row: [],
    field: '',
    inQuotes: false,
    fieldWasQuoted: false,
    cells: 0,
    maxRows: options.maxRows ?? MAX_RAW_ROWS,
  };

  for (let i = 0; i < text.length; i += 1) {
    i += state.inQuotes
      ? readQuoted(state, text[i], text[i + 1])
      : readUnquoted(state, text[i], text[i + 1], delimiter);
  }
  // A file that does not end in a newline still has a final row.
  if (state.field !== '' || state.row.length > 0) closeRow(state);

  return state.rows;
}
