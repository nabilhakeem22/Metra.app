// BARREL LAW: a module barrel re-exports only symbols defined under that module's
// own `core/`, `lifecycle/` or `queries/`. It never re-exports a shared kernel and
// it never re-exports another module. Cross-module reuse goes through
// `lib/<kernel>`.
//
// Barrel for the variation-core surface. The single 312-line `core.ts` was split
// by operation group (SRP): `create` (createVariationDraftCore), `update`
// (saveVariationDraftCore), and the pre-existing sibling `../lifecycle`
// (internal-approve / issue) — re-exported here so `@/lib/variations/core` stays
// the one import surface for callers/tests. Pure structural refactor — no query,
// type, or behaviour changed.
export * from './create';
export * from './update';
export {
  internalApproveVariationCore,
  issueVariationCore,
} from '../lifecycle';
