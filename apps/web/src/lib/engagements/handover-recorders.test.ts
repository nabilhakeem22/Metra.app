import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from '@/lib/permissions/roles';
import { mayRecordHandoverConfirmation } from './handover-recorders';
import { mayRecordOfflineApproval } from './offline-approval';

describe('mayRecordHandoverConfirmation (owner decision, Oct 9)', () => {
  it('owner, admin and project manager only: the ending deciders', () => {
    expect(MEMBER_ROLES.filter(mayRecordHandoverConfirmation)).toEqual(['owner', 'admin', 'project_manager']);
  });

  it('is the same set as the offline approval recorders', () => {
    for (const role of MEMBER_ROLES) expect(mayRecordHandoverConfirmation(role), role).toBe(mayRecordOfflineApproval(role));
  });
});
