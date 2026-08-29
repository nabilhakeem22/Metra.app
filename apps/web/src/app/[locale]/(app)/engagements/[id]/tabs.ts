// Server-safe tab constants for the engagement detail page. PLAIN module (NOT
// 'use client') so both the server page and the client detail component may
// import it without turning it into a client-reference proxy.
//
// The command-card redesign moves "what's next" into the top command card; this
// strip holds the fuller record below it. Files is the default (the studio's most
// common lookup). The commercial pulse, the fee schedule (audit ledger) and the
// build-cost range are folded into the Payments tab; the recent-activity + client
// feed into Timeline.
export const ENGAGEMENT_TABS = [
  'files',
  'timeline',
  'payments',
  'changeOrders',
] as const;

export type EngagementTab = (typeof ENGAGEMENT_TABS)[number];
