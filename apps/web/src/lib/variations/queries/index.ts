// BARREL LAW: a module barrel re-exports only symbols defined under that module's
// own `core/`, `lifecycle/` or `queries/`. It never re-exports a shared kernel and
// it never re-exports another module. Cross-module reuse goes through
// `lib/<kernel>`.
//
// The variation read model. There is exactly one surface — the register that the
// contract detail page draws — and after the dead detail queries were deleted
// that is all `list` holds. The barrel exists so the module matches `proposals`
// and `contracts`, and so a second read concern lands as a sibling file rather
// than as another 190-line `queries.ts`.
export * from './list';
