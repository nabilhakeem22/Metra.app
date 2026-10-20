import type { MemberRole } from '@metra/db';
import { describe, expect, it } from 'vitest';
import { mayIssueRequests, mayRecordPayments, maySeeBilling } from './access';

// The Payments tab's gates for all seven roles (plan A18, A4 security S4). The
// client role is refused by name, whatever the matrix grants it for the portal.

const MATRIX: Record<MemberRole, { see: boolean; issue: boolean; record: boolean }> = {
  owner: { see: true, issue: true, record: true },
  admin: { see: true, issue: true, record: true },
  accountant: { see: true, issue: true, record: true },
  project_manager: { see: true, issue: false, record: false },
  viewer: { see: true, issue: false, record: false },
  site_engineer: { see: false, issue: false, record: false },
  client: { see: false, issue: false, record: false },
};

describe('the Payments tab gates', () => {
  it.each(Object.entries(MATRIX) as [MemberRole, (typeof MATRIX)[MemberRole]][])('%s', (role, expected) => {
    expect({ see: maySeeBilling(role), issue: mayIssueRequests(role), record: mayRecordPayments(role) }).toEqual(expected);
  });
});
