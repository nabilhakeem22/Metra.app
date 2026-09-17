// Barrel for the dashboard's reads. `dashboard/queries.ts` was 210 lines doing
// three unrelated jobs — the headline counts, the monthly trend series, and the
// deliveries triage list — so it split along those lines when wave 4 added a
// fourth caller to it (`firm-figures.ts`). This index re-exports the IDENTICAL
// public surface, so every `@/lib/dashboard/queries` import site keeps resolving
// unchanged. Pure structural refactor: no query, type or figure changed.
export { getDashboardCounts, type DashboardCounts } from './counts';
export {
  getClientsByMonth,
  getProjectsByMonth,
  type ClientsMonth,
  type ProjectsMonth,
} from './trends';
export {
  countActiveDeliveries,
  listDashboardDeliveries,
  type DashboardDelivery,
} from './deliveries';
