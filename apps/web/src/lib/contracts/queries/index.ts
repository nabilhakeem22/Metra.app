// BARREL LAW: a module barrel re-exports only symbols defined under that module's
// own `core/`, `lifecycle/` or `queries/`. It never re-exports a shared kernel and
// it never re-exports another module. Cross-module reuse goes through
// `lib/<kernel>`.
//
// The contract read model, grouped by concern:
//   list    -> the paginated register (listContracts)
//   detail  -> the full contract-with-lines view + PDF loader
//   lookups -> small single-row/id helpers (send meta, proposal linkage)
export * from './list';
export * from './detail';
export * from './lookups';
