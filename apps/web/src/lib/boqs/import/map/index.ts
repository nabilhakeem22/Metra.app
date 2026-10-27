// Barrel for the BOQ sheet mapper. The single 309-line `map.ts` was split by job:
// `columns` (the import fields, header aliases and the header-to-column match),
// `cells` (reading one cell: money, unit, the row-issue codes) and `rows` (a
// verdict per data row). Every `@/lib/boqs/import/map` import site keeps
// resolving unchanged, and the cell readers stay internal.
//
// Turn a decoded grid into draft BOQ lines, with a per-row verdict the preview
// can render. PURE — no db, no server-only — so the preview shows exactly what
// the commit will write.
//
// Nothing here knows what a CSV is. It takes a SheetGrid, so the same code
// serves an XLSX decoder unchanged.
export {
  IMPORT_FIELDS,
  type ImportField,
  type ColumnMapping,
  CANONICAL_HEADERS,
  autoDetectMapping,
} from './columns';
export { type BoqImportRowIssue, normalizeUnit } from './cells';
export { type ImportedLine, type MapResult, DEFAULT_SECTION, mapRows } from './rows';
