// BARREL LAW: a module barrel re-exports only symbols defined under that module's
// own `core/`, `lifecycle/` or `queries/`. It never re-exports a shared kernel and
// it never re-exports another module. Cross-module reuse goes through
// `lib/<kernel>`.
//
// The proposal lifecycle transitions, one per file — the shape `variations`
// already uses. `lifecycle.ts` was 255 lines and four unrelated state changes.
export * from './send';
export * from './expire';
export * from './supersede';
export * from './delete-draft';
