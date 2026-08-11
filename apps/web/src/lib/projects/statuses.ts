// Client-safe mirror of the project_status enum. Declaring the tokens here (typed
// against @metra/db's ProjectStatus via a TYPE-only import, so no drizzle/postgres
// is pulled into the client bundle) lets client components render the status list
// without importing the schema barrel.
import type { ProjectStatus } from '@metra/db';

export const PROJECT_STATUSES: readonly ProjectStatus[] = [
  'draft',
  'active',
  'on_hold',
  'completed',
  'cancelled',
];
