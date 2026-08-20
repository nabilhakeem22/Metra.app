// The two isolated org fixtures (A and B) the seed writes a row of every
// org-scoped table for. Shared by the per-domain seed helpers + the orchestrator.
import {
  API_KEY_A_ID,
  API_KEY_B_ID,
  CLIENT_A_ID,
  CLIENT_B_ID,
  CONTRACT_A_ID,
  CONTRACT_B_ID,
  COST_ITEM_A_ID,
  COST_ITEM_B_ID,
  FILE_A_ID,
  FILE_B_ID,
  INVITE_A_ID,
  INVITE_B_ID,
  ORG_A_ID,
  ORG_B_ID,
  PRICE_CHANGE_A_ID,
  PRICE_CHANGE_B_ID,
  PRICE_LINE_A_ID,
  PRICE_LINE_B_ID,
  PROJECT_A_ID,
  PROJECT_B_ID,
  PROPOSAL_A_ID,
  PROPOSAL_B_ID,
  USER_A_ID,
  USER_B_ID,
  VARIATION_A_ID,
  VARIATION_B_ID,
} from './seed-constants';

export interface OrgSeed {
  orgId: string;
  userId: string;
  fileId: string;
  inviteId: string;
  inviteEmail: string;
  inviteTokenHash: string;
  nameAr: string;
  nameEn: string;
  costItemId: string;
  priceChangeId: string;
  priceLineId: string;
  costItemCode: string;
  clientId: string;
  projectId: string;
  projectCode: string;
  proposalId: string;
  contractId: string;
  variationId: string;
  apiKeyId: string;
}

export const orgs: OrgSeed[] = [
  {
    orgId: ORG_A_ID,
    userId: USER_A_ID,
    fileId: FILE_A_ID,
    inviteId: INVITE_A_ID,
    inviteEmail: 'invitee-a@example.com',
    inviteTokenHash: 'seed-token-hash-a',
    nameAr: 'شركة ألف للتشطيبات',
    nameEn: 'Org A Fit-out',
    costItemId: COST_ITEM_A_ID,
    priceChangeId: PRICE_CHANGE_A_ID,
    priceLineId: PRICE_LINE_A_ID,
    costItemCode: 'SEED-A-001',
    clientId: CLIENT_A_ID,
    projectId: PROJECT_A_ID,
    projectCode: 'PRJ-A-001',
    proposalId: PROPOSAL_A_ID,
    contractId: CONTRACT_A_ID,
    variationId: VARIATION_A_ID,
    apiKeyId: API_KEY_A_ID,
  },
  {
    orgId: ORG_B_ID,
    userId: USER_B_ID,
    fileId: FILE_B_ID,
    inviteId: INVITE_B_ID,
    inviteEmail: 'invitee-b@example.com',
    inviteTokenHash: 'seed-token-hash-b',
    nameAr: 'شركة باء للتشطيبات',
    nameEn: 'Org B Fit-out',
    costItemId: COST_ITEM_B_ID,
    priceChangeId: PRICE_CHANGE_B_ID,
    priceLineId: PRICE_LINE_B_ID,
    costItemCode: 'SEED-B-001',
    clientId: CLIENT_B_ID,
    projectId: PROJECT_B_ID,
    projectCode: 'PRJ-B-001',
    proposalId: PROPOSAL_B_ID,
    contractId: CONTRACT_B_ID,
    variationId: VARIATION_B_ID,
    apiKeyId: API_KEY_B_ID,
  },
];
