// Barrel for the client reads. The single 187-line `queries.ts` was split by
// job: `list` (the filtered list, with and without project counts), `lookup`
// (the form's client options and one client by id) and `overview` (the profile's
// figures). Every `@/lib/clients/queries` import site keeps resolving unchanged.
export * from './list';
export * from './lookup';
export * from './overview';
