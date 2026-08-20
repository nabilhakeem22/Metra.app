// Barrel for the contract read model, grouped by concern:
//   list    → the paginated register (listContracts)
//   detail  → the full contract-with-lines view + PDF loader
//   lookups → small single-row/id helpers (send meta, proposal linkage)
export * from './queries-list';
export * from './queries-detail';
export * from './queries-lookups';
