// Deterministic ids so the isolation test knows the two tenants without needing
// to query across the RLS boundary (which is impossible by design).
export const ORG_A_ID = '00000000-0000-4000-8000-00000000000a';
export const ORG_B_ID = '00000000-0000-4000-8000-00000000000b';

export const USER_A_ID = '00000000-0000-4000-8000-0000000000a1';
export const USER_B_ID = '00000000-0000-4000-8000-0000000000b1';

export const FILE_A_ID = '00000000-0000-4000-8000-0000000000fa';
export const FILE_B_ID = '00000000-0000-4000-8000-0000000000fb';

export const INVITE_A_ID = '00000000-0000-4000-8000-0000000000c1';
export const INVITE_B_ID = '00000000-0000-4000-8000-0000000000c2';

// Price Book (P1 Slice 1) seed ids.
export const COST_ITEM_A_ID = '00000000-0000-4000-8000-0000000000d1';
export const COST_ITEM_B_ID = '00000000-0000-4000-8000-0000000000d2';
export const PRICE_CHANGE_A_ID = '00000000-0000-4000-8000-0000000000e1';
export const PRICE_CHANGE_B_ID = '00000000-0000-4000-8000-0000000000e2';
export const PRICE_LINE_A_ID = '00000000-0000-4000-8000-0000000000f1';
export const PRICE_LINE_B_ID = '00000000-0000-4000-8000-0000000000f2';

// Clients + Projects (P1 Slice 2) seed ids.
export const CLIENT_A_ID = '00000000-0000-4000-8000-0000000000a2';
export const CLIENT_B_ID = '00000000-0000-4000-8000-0000000000b2';
export const PROJECT_A_ID = '00000000-0000-4000-8000-0000000000a3';
export const PROJECT_B_ID = '00000000-0000-4000-8000-0000000000b3';

// Public API keys (v1) seed ids. Deterministic token hashes so the isolation
// gate has an org-A and an org-B api_keys row to prove it can't leak.
export const API_KEY_A_ID = '00000000-0000-4000-8000-0000000000a7';
export const API_KEY_B_ID = '00000000-0000-4000-8000-0000000000b7';

// Contracts + Variation Orders (P1 Slice 4) seed ids.
export const PROPOSAL_A_ID = '00000000-0000-4000-8000-0000000000a4';
export const PROPOSAL_B_ID = '00000000-0000-4000-8000-0000000000b4';
export const CONTRACT_A_ID = '00000000-0000-4000-8000-0000000000a5';
export const CONTRACT_B_ID = '00000000-0000-4000-8000-0000000000b5';
export const VARIATION_A_ID = '00000000-0000-4000-8000-0000000000a6';
export const VARIATION_B_ID = '00000000-0000-4000-8000-0000000000b6';
