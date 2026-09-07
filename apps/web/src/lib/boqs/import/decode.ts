// The seam between "a file the studio uploaded" and "rows Metra understands".
//
// EVERYTHING ELSE IN THE IMPORT PIPELINE — column mapping, validation, the
// preview, the commit — works against `SheetGrid` and knows nothing about file
// formats. That is the whole point: CSV ships first because it is a hundred
// lines and no dependency, and XLSX slots in later as a second decoder without
// touching a line of the pipeline it feeds.
//
// Pure and client-safe: no server-only import, so the preview can decode in the
// browser before anything is uploaded.

/** A decoded sheet: rows of cells, already trimmed, nothing coerced. */
export interface SheetGrid {
  rows: string[][];
}

export interface DecodeResult {
  grid: SheetGrid;
  /** What the decoder had to guess. Surfaced so the preview can say so. */
  notes: string[];
}

/**
 * Egyptian Windows commonly sets the list separator to a semicolon, so an Excel
 * "Save as CSV" there produces `a;b;c` while the same action elsewhere produces
 * `a,b,c`. Guessing wrong yields one giant column, which is the failure that
 * looks like a broken import rather than a locale mismatch — so sniff it rather
 * than assume, and count only separators OUTSIDE quotes.
 */
export function sniffDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    const ch = firstLine[i];
    if (ch === '"') {
      // A doubled quote inside a quoted field is an escaped quote, not a toggle.
      if (inQuotes && firstLine[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) {
      counts[ch] += 1;
    }
  }
  if (counts[';'] > counts[','] && counts[';'] >= counts['\t']) return ';';
  if (counts['\t'] > counts[','] && counts['\t'] > counts[';']) return '\t';
  return ',';
}

/**
 * RFC 4180-shaped CSV: quoted fields may contain the delimiter, newlines and
 * doubled quotes. Hand-rolled rather than pulled in as a dependency — the repo
 * holds a no-new-dependency fence and this is the whole of what we need.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  // Excel writes a UTF-8 BOM; left in place it becomes part of the first header
  // and every column mapping silently misses.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // swallow; the \n that follows ends the row
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  // A file that does not end in a newline still has a final row.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.map((r) => r.map((c) => c.trim()));
}

/** Drop rows that are entirely empty — Excel leaves thousands of them. */
function dropBlankRows(rows: string[][]): string[][] {
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** Decode an uploaded CSV into a grid. */
export function decodeCsv(text: string): DecodeResult {
  const notes: string[] = [];
  const delimiter = sniffDelimiter(text);
  if (delimiter !== ',') {
    notes.push(
      delimiter === ';'
        ? 'Read as semicolon-separated.'
        : 'Read as tab-separated.',
    );
  }
  const rows = dropBlankRows(parseCsv(text, delimiter));
  return { grid: { rows }, notes };
}
