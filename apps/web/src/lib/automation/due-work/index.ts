// Barrel for the runner's due-work reads. The single 207-line `due-work.ts` was
// split by subject: `proposals` (expiry, pre-expiry nudge, follow-up), `digest`
// (the portfolio figures), `stages` (overdue and upcoming) and `owner-admins`
// (the digest and stage recipients). Every `@/lib/automation/due-work` import
// site keeps resolving unchanged.
//
// All of these run INSIDE a single-org withOrgContext RLS tx (the runner opens
// it per org). Date columns are compared against Cairo `YYYY-MM-DD` strings.
export * from './proposals';
export * from './digest';
export * from './stages';
export * from './owner-admins';
