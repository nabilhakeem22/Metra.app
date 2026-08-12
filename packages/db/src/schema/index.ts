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
export * from './projects';
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
import { projects } from './projects';
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
  projects,
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
  projects,
  proposals,
  proposalSections,
  proposalLines,
  proposalEvents,
} as const;
