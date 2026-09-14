// The BOQ import's view of the shared decoder.
//
// Everything that used to live here now lives in lib/import: the CSV parser, the
// delimiter sniff, the BOM strip and the row caps were all duplicated against the
// price-book pipeline, and the two copies had already diverged on the double
// quote. THIS one opened quote mode on ANY `"`, so `3" pipe` — an inch mark, and
// a fit-out BOQ is full of them — swallowed the rest of the file into one field
// and the import silently lost every row after it. The shared parser keeps the
// price book's rule, which reads a real sheet correctly.
//
// Kept as a module rather than deleted so the pipeline's import sites and its
// `SheetGrid` type keep resolving from where they always did. Still PURE and
// CLIENT-SAFE: the preview decodes in the browser before anything is uploaded.
export {
  decodeCsv,
  padToRectangle,
  sniffDelimiter,
  stripBom,
  type DecodeResult,
  type SheetGrid,
} from '@/lib/import/decode';
export { parseCsvRows } from '@/lib/import/parse-csv';
export {
  ImportParseError,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  MAX_RAW_ROWS,
  type ImportParseReason,
} from '@/lib/import/limits';
