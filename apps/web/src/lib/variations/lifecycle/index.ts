// BARREL LAW: a module barrel re-exports only symbols defined under that module's
// own `core/`, `lifecycle/` or `queries/`. It never re-exports a shared kernel and
// it never re-exports another module. Cross-module reuse goes through
// `lib/<kernel>`.
//
// Barrel for the variation-order lifecycle transitions. The single `lifecycle.ts`
// was split by transition (SRP) once each one grew its own contract-activity
// guard: `internal-approve` (draft->internal_approved, mints the client token)
// and `issue` (internal_approved->issued). Re-exported here so
// `@/lib/variations/lifecycle` stays the one import surface.
export * from './internal-approve';
export * from './issue';
export * from './terminate-rejection';
