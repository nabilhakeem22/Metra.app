// Barrel for the Design-Engagement guard engine. The single 430-line `guards.ts`
// was split into cohesive per-concern modules (SRP): the `facts` contract, the
// `money` gate family, the `readiness` gate family, and the `registry` that
// composes them. This index re-exports the IDENTICAL public surface so every
// `@/lib/engagements/guards` import site keeps resolving unchanged. Named
// re-exports (not `export *`) because the individual guard predicates are
// module-private helpers that compose into `GUARDS` — only the original public
// names are re-exported here. Pure structural refactor — no guard, type, or
// behaviour changed.
export type { GuardFacts, GuardResult, GuardKey } from './facts';
export {
  MONEY_GUARD_MILESTONE,
  milestoneRequired4,
  milestoneShortfall4,
  moneyGuardOf,
} from './money';
export { GUARDS } from './registry';
