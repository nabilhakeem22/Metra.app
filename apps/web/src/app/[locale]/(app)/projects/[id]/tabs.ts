// Server-safe tab constants. Kept OUT of the 'use client' profile-tabs module:
// a server component (page.tsx) importing a value from a client module gets a
// client-reference proxy, not the real array — so `PROJECT_TABS.includes` throws.
//
// `stages` was removed (projects spec): stages are no longer MANAGED here. Where the
// project has reached is read-only information now, shown on Overview alongside the
// delivery panel. The project_stages data and its automation digest are untouched.
export const PROJECT_TABS = [
  'overview',
  'details',
  'financials',
  'team',
  'proposals',
  'documents',
  'activity',
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];
