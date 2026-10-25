'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { assignSiteMemberCore, unassignSiteMemberCore, type SiteTeamInput } from './core';

export async function assignSiteMember(input: SiteTeamInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const result = await assignSiteMemberCore(ctx, input);
  if (result.ok) refreshApp();
  return result;
}

export async function unassignSiteMember(input: SiteTeamInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const result = await unassignSiteMemberCore(ctx, input);
  if (result.ok) refreshApp();
  return result;
}
