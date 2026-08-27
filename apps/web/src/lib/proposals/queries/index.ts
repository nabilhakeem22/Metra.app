// Barrel for the proposal read layer. The single 350-line `queries.ts` was split
// into cohesive per-concern modules (SRP): the `list` surface, the full `detail`
// (margin-gated) loader, and the non-cost `send-meta`. This index re-exports them
// so every `@/lib/proposals/queries` import site keeps resolving unchanged. Pure
// structural refactor — no query, type, or behaviour changed.
export * from './list';
export * from './detail';
export * from './send-meta';
