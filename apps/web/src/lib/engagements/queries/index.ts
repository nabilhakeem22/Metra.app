// Barrel for the engagement read layer. The single 632-line `queries.ts` was split
// into cohesive per-concern modules (SRP); this index re-exports them so every
// `@/lib/engagements/queries` import site keeps resolving unchanged. Pure structural
// refactor — no query, type, or behaviour changed.
export * from './list';
export * from './by-project';
export * from './header';
export * from './timeline';
export * from './money';
export * from './artifacts';
