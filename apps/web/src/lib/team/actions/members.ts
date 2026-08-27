'use server';

import { type MemberRole } from '@metra/db';
import { requireOrg } from '@/lib/auth/require-org';
import { type ActionResult } from '@/lib/actions/result';
import { changeMemberRoleCore, removeMemberCore } from '../core';

// --- Change role / remove member (delegate to pure cores) ------------------
export async function changeMemberRole(input: {
  userId: string;
  role: MemberRole;
}): Promise<ActionResult> {
  const ctx = await requireOrg();
  return changeMemberRoleCore(ctx, input);
}

export async function removeMember(userId: string): Promise<ActionResult> {
  const ctx = await requireOrg();
  return removeMemberCore(ctx, userId);
}
