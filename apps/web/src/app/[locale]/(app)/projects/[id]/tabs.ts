// Server-safe tab constants. Kept OUT of the 'use client' profile-tabs module:
// a server component (page.tsx) importing a value from a client module gets a
// client-reference proxy, not the real array — so `PROJECT_TABS.includes` throws.
export const PROJECT_TABS = [
  'overview',
  'details',
  'stages',
  'financials',
  'team',
  'proposals',
  'documents',
  'activity',
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];
