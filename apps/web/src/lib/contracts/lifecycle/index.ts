// BARREL LAW: a module barrel re-exports only symbols defined under that module's
// own `core/`, `lifecycle/` or `queries/`. It never re-exports a shared kernel and
// it never re-exports another module. Cross-module reuse goes through
// `lib/<kernel>`.
//
// The contract lifecycle transitions, one per file — the shape `variations` and
// `proposals` already use.
export * from './issue';
export * from './terminate';
