// BARREL LAW: a module barrel re-exports only symbols defined under that module's
// own `core/`, `lifecycle/` or `queries/`. It never re-exports a shared kernel and
// it never re-exports another module. Cross-module reuse goes through
// `lib/<kernel>`.
//
// The contract read model, grouped by concern:
//   list    -> the paginated register (listContractsPage)
//   detail  -> the bounded contract page + the every-line PDF loader
//   section-summaries -> the page's sections, a page at a time
//   section-lines -> one section's lines, a page at a time
//   line-search   -> the variation picker's line search
//   lookups -> small single-row/id helpers (send meta, proposal linkage)
export * from './list';
export * from './detail';
export * from './section-summaries';
export * from './section-lines';
export * from './line-search';
export * from './lookups';
