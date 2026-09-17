// Barrel for the Design-Engagement guard engine. The single 430-line `guards.ts`
// was split into cohesive per-concern modules (SRP): the `facts` contract, the
// money family (`milestone-math`, `money-milestones`, `money-change-orders`,
// `trigger-money-gate`), the readiness family, and the `registry` that
// composes them. This index re-exports the IDENTICAL public surface so every
// `@/lib/engagements/guards` import site keeps resolving unchanged. Named
// re-exports (not `export *`) because the individual guard predicates are
// module-private helpers that compose into `GUARDS` — only the original public
// names are re-exported here. Pure structural refactor — no guard, type, or
// behaviour changed.
export type { GuardFacts, GuardResult, GuardKey } from './facts';
export { milestoneRequired4, milestoneShortfall4 } from './milestone-math';
export { MONEY_GUARD_MILESTONE, moneyGuardOf } from './trigger-money-gate';
export { GUARDS } from './registry';
