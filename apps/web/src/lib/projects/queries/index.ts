// Barrel for the project reads. The single 185-line `queries.ts` was split by
// job: `list` (the filtered list with the client name), `by-id` (one project with
// its type name) and `overview` (the profile's figures). Every
// `@/lib/projects/queries` import site keeps resolving unchanged.
export * from './list';
export * from './by-id';
export * from './overview';
