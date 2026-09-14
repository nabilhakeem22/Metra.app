/**
 * Text in, grid out: the seam between "a file the studio uploaded" and "rows
 * Metra understands".
 *
 * PURE and CLIENT-SAFE (no `server-only`): the BOQ preview decodes in the
 * browser before anything is uploaded. Everything downstream — column mapping,
 * validation, preview, commit — works against `SheetGrid` and knows nothing
 * about file formats, which is what lets a second decoder slot in later without
 * touching the pipeline it feeds.
 */
import { parseCsvRows } from './parse-csv';
import { MAX_RAW_ROWS } from './limits';

/** A decoded sheet: rows of cells, already trimmed, nothing coerced. */
export interface SheetGrid {
  rows: string[][];
}

export interface DecodeResult {
  grid: SheetGrid;
  /** What the decoder had to GUESS. Surfaced so the preview can say so — a
   *  guess the studio cannot see is a guess it cannot correct. */
  notes: string[];
}

/** Excel writes a UTF-8 BOM; left in place it becomes part of the first header
 *  cell and every column mapping silently misses. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Egyptian Windows commonly sets the list separator to a semicolon, so an Excel
 * "Save as CSV" there produces `a;b;c` while the same action elsewhere produces
 * `a,b,c`. Guessing wrong yields one giant column — the failure that looks like
 * a broken import rather than a locale mismatch — so sniff it rather than
 * assume, and count only separators OUTSIDE quotes.
 */
export function sniffDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const character = firstLine[i];
    if (character === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a toggle.
      if (inQuotes && firstLine[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && (character === ',' || character === ';' || character === '\t')) {
      counts[character] += 1;
    }
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/** Drop rows that are entirely empty — Excel leaves thousands of them. */
function dropBlankRows(rows: string[][]): string[][] {
  return rows.filter((row) => row.some((cell) => cell !== ''));
}

/** Decode an uploaded CSV into a grid. Throws ImportParseError('too_many_rows')
 *  if the raw row count runs away before blank-filtering. */
export function decodeCsv(
  text: string,
  options: { maxRows?: number } = {},
): DecodeResult {
  const source = stripBom(text);
  const notes: string[] = [];
  const delimiter = sniffDelimiter(source);
  if (delimiter !== ',') {
    notes.push(
      delimiter === ';' ? 'Read as semicolon-separated.' : 'Read as tab-separated.',
    );
  }
  const rows = dropBlankRows(
    parseCsvRows(source, { delimiter, maxRows: options.maxRows ?? MAX_RAW_ROWS }),
  );
  return { grid: { rows }, notes };
}

/**
 * Pad every row to the widest one, so the mapping and preview steps see uniform
 * columns. Separate from decodeCsv because only the price-book pipeline wants
 * it: the BOQ preview renders ragged rows as they are, and padding them would
 * invent empty cells the studio never typed.
 */
export function padToRectangle(rows: string[][]): string[][] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  for (const row of rows) {
    while (row.length < width) row.push('');
  }
  return rows;
}
