// Which entity a document is stapled to, and what that implies.
//
// A PLAIN module: not 'use server', not 'use client', no `server-only`. It is
// imported by server actions AND by the two client tab components that pass a
// spec down, so it must be loadable from both sides — a value exported from a
// 'use client' module and read by a server component becomes a client-reference
// proxy and 500s at runtime while passing tsc.
//
// `lib/client-documents/` and `lib/project-documents/` were token-for-token
// identical modulo the word client/project: `diff` after s/client/ENTITY/ exited
// 0 on the queries and reported only comment wording on the actions. Two copies
// of a file-attachment path is two places for one of them to stop checking that
// the parent row is in-org.
import { clients, projects } from '@metra/db';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Capability } from '@/lib/permissions/roles';

/** The `files.entity` discriminator. Stored on the row; also the storage prefix. */
export type DocumentEntity = 'client' | 'project';

export interface DocumentEntitySpec {
  entity: DocumentEntity;
  /** Gates upload and delete — the broad activity/document audience. */
  writeCapability: Capability;
  /** Gates minting a download URL — whoever may read the parent record. */
  readCapability: Capability;
  /** The parent row that must exist IN THIS ORG before a file is attached to it. */
  parentTable: PgTable & { id: PgColumn };
}

export const DOCUMENT_ENTITIES: Record<DocumentEntity, DocumentEntitySpec> = {
  client: {
    entity: 'client',
    writeCapability: 'client_activity',
    readCapability: 'clients',
    parentTable: clients,
  },
  project: {
    entity: 'project',
    writeCapability: 'project_activity',
    readCapability: 'projects',
    parentTable: projects,
  },
};
