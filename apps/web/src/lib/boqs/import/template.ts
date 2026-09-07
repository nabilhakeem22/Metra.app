// The BOQ template a studio downloads, fills in Excel, and uploads back.
//
// PURE and format-specific: this is the write half of the seam that `decode.ts`
// is the read half of. When an XLSX writer lands it replaces this file and
// nothing else, because the column ORDER and the header TEXT are the contract —
// and they are the same strings `autoDetectMapping` already recognises, so a
// returned template maps itself with nothing for the studio to confirm.

import { IMPORT_FIELDS, type ImportField } from './map';

/**
 * Byte-order mark.
 *
 * It is load-bearing: Excel assumes the system ANSI codepage for a CSV opened by
 * double-click, so without it every Arabic description in a downloaded template
 * renders as mojibake. `decode.ts` strips it on the way back in, so the round
 * trip is clean.
 *
 * Isolated into this one named constant on purpose. It is an invisible character,
 * so inline it would be unreviewable — and eslint's no-irregular-whitespace
 * rejects one inside a template literal for exactly that reason, which is how the
 * first version of this file was caught.
 */
const BOM = '﻿';

/** Header text per column. These exact strings are what auto-detection matches. */
const HEADERS: Record<ImportField, string> = {
  itemCode: 'Item',
  section: 'Section',
  description: 'Description',
  unit: 'Unit',
  qty: 'Qty',
  unitPrice: 'Unit price',
  unitCost: 'Unit cost',
  provisional: 'Provisional',
  costItemCode: 'Price book',
};

/**
 * One filled row, so the studio can see the expected shape of the two columns
 * that are not self-evident — `Unit` takes Metra's vocabulary, `Provisional`
 * takes yes/no. Its Item code says what it is: if it survives to upload, the
 * import PREVIEW lists it as a line about to be created, which is exactly the
 * moment the studio will notice and drop it.
 */
const EXAMPLE: Record<ImportField, string> = {
  itemCode: 'EXAMPLE - delete this row',
  section: 'Gypsum works',
  description: '12mm gypsum ceiling, suspended',
  unit: 'sqm',
  qty: '100',
  unitPrice: '1500',
  unitCost: '900',
  provisional: 'no',
  costItemCode: '',
};

/** The five units Metra understands, for the instructions beside the download. */
export const TEMPLATE_UNITS = [
  'sqm',
  'linear_meter',
  'pcs',
  'lump_sum',
  'day',
] as const;

/**
 * RFC 4180 quoting: wrap when the value contains a delimiter, a quote or a
 * newline, and double any quote inside. Without it a description containing a
 * comma — which most of them do — silently becomes two columns.
 */
function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** One price-book item, as the template lists it. */
export interface TemplateItem {
  code: string;
  description: string;
  unit: string;
  unitPrice: string;
  unitCost: string;
  section?: string | null;
}

export interface TemplateOptions {
  /**
   * The studio's price book. Each item becomes a row with everything filled in
   * EXCEPT the quantity — so a project is priced by typing quantities against
   * rates already agreed, rather than by retyping the firm's own catalogue.
   *
   * A row left without a quantity is an item this project does not use; the
   * importer SKIPS it rather than reporting it, which is the whole reason a
   * catalogue-sized template is usable at all.
   */
  items?: TemplateItem[];
  /**
   * Include the worked example. Defaults to on only when there is no price book
   * to demonstrate the format — a fake row sitting among real priced items is a
   * row somebody imports by accident.
   */
  includeExample?: boolean;
}

/** Build the template as CSV text. */
export function buildTemplateCsv(opts: TemplateOptions = {}): string {
  const items = opts.items ?? [];
  const rows = [IMPORT_FIELDS.map((f) => HEADERS[f])];

  if (opts.includeExample ?? items.length === 0) {
    rows.push(IMPORT_FIELDS.map((f) => EXAMPLE[f]));
  }

  for (const item of items) {
    const cells: Record<ImportField, string> = {
      itemCode: '',
      section: item.section ?? '',
      description: item.description,
      unit: item.unit,
      // Blank ON PURPOSE — this is the one column the studio fills.
      qty: '',
      unitPrice: item.unitPrice,
      unitCost: item.unitCost,
      provisional: 'no',
      costItemCode: item.code,
    };
    rows.push(IMPORT_FIELDS.map((f) => cells[f]));
  }
  // CRLF: Excel's own dialect, and harmless everywhere else.
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return `${BOM}${body}\r\n`;
}

/** `metra-boq-template.csv`, or a project-specific name when one is known. */
export function templateFilename(projectCode?: string | null): string {
  const stem = projectCode ? `boq-template-${projectCode}` : 'metra-boq-template';
  // Keep it filesystem-safe across Windows and macOS.
  return `${stem.replace(/[^A-Za-z0-9._-]+/g, '-')}.csv`;
}
