// Barrel. Import order matters for the organizations<->_helpers circular ref:
// enums first, then organizations, then org-scoped tables.
export * from './enums';
export * from './organizations';
export * from './memberships';
export * from './audit-log';
export * from './files';

import { organizations } from './organizations';
import { memberships } from './memberships';
import { auditLog } from './audit-log';
import { files } from './files';

/** Every org-scoped business table (carries org_id). Drives RLS generation. */
export const orgScopedTables = { memberships, auditLog, files } as const;

/** All tables including the tenant root. */
export const allTables = { organizations, memberships, auditLog, files } as const;
