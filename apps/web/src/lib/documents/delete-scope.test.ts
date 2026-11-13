import { describe, expect, it } from 'vitest';
import { can } from '@/lib/permissions/can';
import { MEMBER_ROLES } from '@/lib/permissions/member-roles';
import type { MemberRole } from '@/lib/permissions/roles';
import { documentDeleteScope, mayDeleteDocument } from './delete-scope';
import { DOCUMENT_ENTITIES, type DocumentEntity } from './entities';

// Security batch 3, A6: deleting a document used to be gated on UPLOAD alone, so
// any operational role could remove any colleague's file. The scope decides
// whose documents a role may remove; the cores that apply it against a real
// database are in tests/actions/documents-delete-scope.dbtest.ts.

const ENTITIES: DocumentEntity[] = ['client', 'project'];
const MAY_DELETE_ANY: MemberRole[] = ['owner', 'admin', 'project_manager'];
const MAY_DELETE_OWN_ONLY: MemberRole[] = ['site_engineer', 'accountant'];

describe.each(ENTITIES)('documentDeleteScope on %s documents (AC11)', (entity) => {
  const spec = DOCUMENT_ENTITIES[entity];

  it.each(MAY_DELETE_ANY)('%s, who may edit the parent record, deletes any document', (role) => {
    expect(documentDeleteScope(role, spec)).toBe('any');
  });

  it.each(MAY_DELETE_OWN_ONLY)('%s, who may only upload, deletes only their own', (role) => {
    expect(documentDeleteScope(role, spec)).toBe('own');
  });

  it('gives `any` to no role that cannot upload, and names every role that can', () => {
    const uploaders = MEMBER_ROLES.filter((role) => can(role, spec.writeCapability, 'create'));
    expect([...uploaders].sort()).toEqual([...MAY_DELETE_ANY, ...MAY_DELETE_OWN_ONLY].sort());
    const anyScope = MEMBER_ROLES.filter((role) => documentDeleteScope(role, spec) === 'any');
    expect([...anyScope].sort()).toEqual([...MAY_DELETE_ANY].sort());
  });
});

describe('mayDeleteDocument', () => {
  const me = '11111111-1111-4111-8111-111111111111';
  const colleague = '22222222-2222-4222-8222-222222222222';

  it('lets the `any` scope delete a colleague upload, its own, and one with no uploader', () => {
    expect(mayDeleteDocument('any', colleague, me)).toBe(true);
    expect(mayDeleteDocument('any', me, me)).toBe(true);
    expect(mayDeleteDocument('any', null, me)).toBe(true);
  });

  it('lets the `own` scope delete only what that member uploaded', () => {
    expect(mayDeleteDocument('own', me, me)).toBe(true);
    expect(mayDeleteDocument('own', colleague, me)).toBe(false);
  });

  it('never treats a document with no uploader as the member own', () => {
    expect(mayDeleteDocument('own', null, me)).toBe(false);
  });
});
