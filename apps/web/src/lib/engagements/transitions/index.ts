// Barrel for the Design-Engagement transition machine. The single 309-line
// `transitions.ts` was split into the contract `types` (triggers, capability
// families, side-effect keys, payloads, `TransitionDef`) and the concrete
// `registry` (the `TRANSITIONS` edge table + `WIRED_TRIGGERS`). This index
// re-exports the IDENTICAL public surface so every `@/lib/engagements/transitions`
// import site keeps resolving unchanged. Pure structural refactor — no type,
// edge, or behaviour changed.
export * from './types';
export * from './registry';
