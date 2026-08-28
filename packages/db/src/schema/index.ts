// Barrel. Import order matters for the organizations<->_helpers circular ref:
// enums first, then organizations, then org-scoped tables.
export * from './enums';
export * from './accounts';
export * from './organizations';
export * from './memberships';
export * from './audit-log';
export * from './files';
export * from './invitations';
export * from './sections';
export * from './section-defaults';
export * from './cost-items';
export * from './price-changes';
export * from './clients';
export * from './client-contacts';
export * from './activities';
export * from './project-types';
export * from './project-type-defaults';
export * from './stage-templates';
export * from './stage-defaults';
export * from './projects';
export * from './project-stages';
export * from './proposals';
export * from './proposal-sections';
export * from './proposal-lines';
export * from './proposal-events';
export * from './contracts';
export * from './contract-sections';
export * from './contract-lines';
export * from './contract-events';
export * from './variation-orders';
export * from './variation-order-lines';
export * from './variation-order-events';
export * from './design-engagements';
export * from './engagement-transitions';
export * from './engagement-milestones';
export * from './payment-events';
export * from './engagement-artifacts';
export * from './engagement-events';
export * from './engagement-change-orders';
export * from './client-payment-claims';
export * from './notifications';
export * from './automation-settings';
export * from './automation-run-log';
export * from './api-keys';
export * from './workspace-entitlements';

import { accounts } from './accounts';
import { organizations } from './organizations';
import { memberships } from './memberships';
import { auditLog } from './audit-log';
import { files } from './files';
import { invitations } from './invitations';
import { sections } from './sections';
import { costItems } from './cost-items';
import { priceChanges, priceChangeLines } from './price-changes';
import { clients } from './clients';
import { clientContacts } from './client-contacts';
import { activities } from './activities';
import { projectTypes } from './project-types';
import { stageTemplates } from './stage-templates';
import { projects } from './projects';
import { projectStages } from './project-stages';
import { proposals } from './proposals';
import { proposalSections } from './proposal-sections';
import { proposalLines } from './proposal-lines';
import { proposalEvents } from './proposal-events';
import { contracts } from './contracts';
import { contractSections } from './contract-sections';
import { contractLines } from './contract-lines';
import { contractEvents } from './contract-events';
import { variationOrders } from './variation-orders';
import { variationOrderLines } from './variation-order-lines';
import { variationOrderEvents } from './variation-order-events';
import { designEngagements } from './design-engagements';
import { engagementTransitions } from './engagement-transitions';
import { engagementMilestones } from './engagement-milestones';
import { paymentEvents } from './payment-events';
import { engagementArtifacts } from './engagement-artifacts';
import { engagementEvents } from './engagement-events';
import { engagementChangeOrders } from './engagement-change-orders';
import { clientPaymentClaims } from './client-payment-claims';
import { notifications } from './notifications';
import { automationSettings } from './automation-settings';
import { automationRunLog } from './automation-run-log';
import { apiKeys } from './api-keys';
import { workspaceEntitlements } from './workspace-entitlements';

/** Every org-scoped business table (carries org_id). Drives RLS generation. */
export const orgScopedTables = {
  memberships,
  auditLog,
  files,
  invitations,
  sections,
  costItems,
  priceChanges,
  priceChangeLines,
  clients,
  clientContacts,
  activities,
  projectTypes,
  stageTemplates,
  projects,
  projectStages,
  proposals,
  proposalSections,
  proposalLines,
  proposalEvents,
  contracts,
  contractSections,
  contractLines,
  contractEvents,
  variationOrders,
  variationOrderLines,
  variationOrderEvents,
  designEngagements,
  engagementTransitions,
  engagementMilestones,
  paymentEvents,
  engagementArtifacts,
  engagementEvents,
  engagementChangeOrders,
  clientPaymentClaims,
  notifications,
  automationSettings,
  automationRunLog,
  apiKeys,
  workspaceEntitlements,
} as const;

/** All tables including the tenant root and the above-tenancy account entity. */
export const allTables = {
  accounts,
  organizations,
  memberships,
  auditLog,
  files,
  invitations,
  sections,
  costItems,
  priceChanges,
  priceChangeLines,
  clients,
  clientContacts,
  activities,
  projectTypes,
  stageTemplates,
  projects,
  projectStages,
  proposals,
  proposalSections,
  proposalLines,
  proposalEvents,
  contracts,
  contractSections,
  contractLines,
  contractEvents,
  variationOrders,
  variationOrderLines,
  variationOrderEvents,
  designEngagements,
  engagementTransitions,
  engagementMilestones,
  paymentEvents,
  engagementArtifacts,
  engagementEvents,
  engagementChangeOrders,
  clientPaymentClaims,
  notifications,
  automationSettings,
  automationRunLog,
  apiKeys,
  workspaceEntitlements,
} as const;
