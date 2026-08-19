// Server-safe tab constants for the contract detail page. PLAIN module (NOT
// 'use client') so both the server page and the client tab component can import
// it without turning it into a client-reference proxy.
export const CONTRACT_TABS = ['overview', 'variations'] as const;

export type ContractTab = (typeof CONTRACT_TABS)[number];
