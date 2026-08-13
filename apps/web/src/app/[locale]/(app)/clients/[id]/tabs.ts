// Server-safe tab constants. Kept OUT of the 'use client' profile-tabs module:
// a server component (page.tsx) importing a value from a client module gets a
// client-reference proxy, not the real array — so `CLIENT_TABS.includes` throws.
export const CLIENT_TABS = [
  'overview',
  'details',
  'contacts',
  'projects',
  'financials',
  'documents',
  'activity',
] as const;

export type ClientTab = (typeof CLIENT_TABS)[number];
