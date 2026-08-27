// Server-safe tab constants for the engagement detail page. PLAIN module (NOT
// 'use client') so both the server page and the client detail component may
// import it without turning it into a client-reference proxy.
//
// The fee schedule (audit ledger) and the activity timeline are NOT tabs — they
// are pinned in the cockpit's right rail (see engagement-right-rail.tsx); this
// strip holds the fuller detail that lives below the fold.
export const ENGAGEMENT_TABS = [
  'payments',
  'artifacts',
  'changeOrders',
  'rom',
  'clientActivity',
] as const;

export type EngagementTab = (typeof ENGAGEMENT_TABS)[number];
