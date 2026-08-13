// Barrel. Import order matters for the organizations<->_helpers circular ref:
// enums first, then organizations, then org-scoped tables.
export * from './enums';
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
} as const;

/** All tables including the tenant root. */
export const allTables = {
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
} as const;
