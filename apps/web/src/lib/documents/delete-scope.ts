// Whose documents a role may delete. A PLAIN module (no `server-only`): the
// list read and the delete core ask the same question of it, so the menu a row
// shows and the answer the server gives cannot drift apart.
//
// A role that may edit the parent record removes any of its documents; every
// other role that may upload removes only what it uploaded itself. Before this
// the delete was gated on upload alone, so a site engineer or an accountant
// could remove a colleague's file, the owner's signed agreement included.
import { can } from '@/lib/permissions/can';
import type { MemberRole } from '@/lib/permissions/roles';
import type { DocumentEntitySpec } from './entities';

/** `any`: every document of the entity. `own`: only the member's own uploads. */
export type DocumentDeleteScope = 'any' | 'own';

/** `any` for a role that may edit the parent record, `own` for everyone else. */
export function documentDeleteScope(role: MemberRole, spec: DocumentEntitySpec): DocumentDeleteScope {
  return can(role, spec.deleteAnyCapability, 'update') ? 'any' : 'own';
}

/** Whether `userId` may delete a document `createdBy` uploaded. A null creator is never "own". */
export function mayDeleteDocument(scope: DocumentDeleteScope, createdBy: string | null, userId: string): boolean {
  return scope === 'any' || createdBy === userId;
}

/**
 * What a listed row tells the page: would the delete core accept this member's
 * delete of this document? The core checks the upload right first and the scope
 * second, so both are asked here. Without the first, a member who uploaded a
 * file and was later made a viewer would be told the file is theirs to delete.
 */
export function isDeletableBy(
  member: { role: MemberRole; userId: string },
  spec: DocumentEntitySpec,
  createdBy: string | null,
): boolean {
  if (!can(member.role, spec.writeCapability, 'create')) return false;
  return mayDeleteDocument(documentDeleteScope(member.role, spec), createdBy, member.userId);
}
