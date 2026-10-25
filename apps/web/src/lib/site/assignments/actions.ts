'use server';

import { refreshApp } from '@/lib/actions/refresh';
import type { ActionResult } from '@/lib/actions/result';
import { requireOrg } from '@/lib/auth/require-org';
import { studioReadRefusal } from '@/lib/cf/studio-read-rate-limit';
import { searchSiteTeamCandidatesCore } from './candidates';
import { assignSiteMemberCore, unassignSiteMemberCore, type SiteTeamInput } from './core';
import type { SiteTeamCandidatesPage } from './types';

export async function assignSiteMember(input: SiteTeamInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const result = await assignSiteMemberCore(ctx, input);
  if (result.ok) refreshApp();
  return result;
}

/** Take a member off; one already taken off elsewhere (entry_not_found) refreshes the list too. */
export async function unassignSiteMember(input: SiteTeamInput): Promise<ActionResult> {
  const ctx = await requireOrg();
  const result = await unassignSiteMemberCore(ctx, input);
  if (result.ok || result.error === 'entry_not_found') refreshApp();
  return result;
}

/** The site team picker's next page, on the member's search budget. */
export async function searchSiteTeamCandidates(input: {
  projectId: string;
  query: string;
  offset: number;
}): Promise<ActionResult & { data?: SiteTeamCandidatesPage }> {
  const ctx = await requireOrg();
  return (await studioReadRefusal(ctx, 'site_team_candidates')) ?? searchSiteTeamCandidatesCore(ctx, input);
}
