// Server-safe tab constants for the engagement detail page. PLAIN module (NOT
// 'use client') so both the server page and the client detail component may
// import it without turning it into a client-reference proxy.
//
// The command card holds "what's next"; this strip holds the fuller record below
// it, and each tab's header holds the actions that write into that record. Files
// is the default (the studio's most common lookup). The commercial pulse and the
// fee schedule sit in Payments; the recent-activity + client feed in Timeline.
//
// ORDER IS THE COMMERCIAL STORY, and Budget sits where it does on purpose: money
// you invoice (Payments), money you estimate (Budget), money that changes (Change
// orders). The build-cost range used to live INSIDE Payments, one section below
// the design fee — two different kinds of money in one tab, which is exactly the
// conflation the schema avoids by keeping rom_low/rom_high apart from the fee
// schedule. The range has versions, acknowledgements and a successor (the BOQ);
// that is a ledger, and it earns a tab on the same logic Payments does.
export const ENGAGEMENT_TABS = [
  'files',
  'timeline',
  'payments',
  'budget',
  'changeOrders',
] as const;

export type EngagementTab = (typeof ENGAGEMENT_TABS)[number];
