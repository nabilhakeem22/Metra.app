// Server-safe tab constants for the engagement detail page. PLAIN module (NOT
// 'use client') so both the server page and the client detail component may
// import it without turning it into a client-reference proxy.
export const ENGAGEMENT_TABS = [
  'fee',
  'payments',
  'artifacts',
  'changeOrders',
  'rom',
  'timeline',
] as const;

export type EngagementTab = (typeof ENGAGEMENT_TABS)[number];
