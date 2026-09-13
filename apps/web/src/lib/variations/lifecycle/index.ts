// Barrel for the variation-order lifecycle transitions. The single `lifecycle.ts`
// was split by transition (SRP) once each one grew its own contract-activity
// guard: `internal-approve` (draft->internal_approved, mints the client token)
// and `issue` (internal_approved->issued). Re-exported here so
// `@/lib/variations/lifecycle` stays the one import surface.
export * from './internal-approve';
export * from './issue';
