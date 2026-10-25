import 'server-only';
// The site team picker's on-demand read (S3 ruling): the studio members a
// manager may add to a project's site team, a page at a time, filtered by
// what he typed. The page is read from the database (ids and roles), then only
// that page is looked up in Supabase auth: at most
// SITE_TEAM_CANDIDATES_PER_CALL lookups per call, never the whole roster in
// one request, and never auth.admin.listUsers (project-wide, it would list
// other studios' people). A typed search answers the page's matches; the
// picker asks for the next page while it has room (nextOffset).
//
// Owner, admin and project manager only (`site_assignments:create`, the right
// to add): the roster stays out of a reader's reach (S2 ruling). The input is
// `unknown` ON PURPOSE: a server action receives whatever was sent.
import { err, type ActionResult } from '@/lib/actions/result';
import { unexpectedFailure } from '@/lib/actions/unexpected';
import type { OrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { cleanSearchQuery } from '@/lib/search/query-input';
import { isUuid } from '@/lib/uuid';
import { matchesMemberSearch } from './candidate-match';
import { withIdentities } from './people';
import { listSiteTeamCandidatePage } from './queries';
import { SITE_TEAM_CANDIDATES_PER_CALL, type SiteTeamCandidatesPage } from './types';

/** The longest search the picker runs; longer input is cut, not refused. */
const MAX_CANDIDATE_SEARCH_LENGTH = 100;

/** No studio has this many members; an offset past it is a forged request. */
const MAX_CANDIDATE_OFFSET = 10_000;

interface CandidateSearch {
  projectId: string;
  query: string;
  offset: number;
}

function isCandidateSearch(input: unknown): input is CandidateSearch {
  const fields = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const { offset } = fields;
  return (
    isUuid(fields.projectId) &&
    typeof fields.query === 'string' &&
    Number.isSafeInteger(offset) &&
    (offset as number) >= 0 &&
    (offset as number) <= MAX_CANDIDATE_OFFSET
  );
}

/** One page of the members who may join the project's site team, matching `query`. */
export async function searchSiteTeamCandidatesCore(
  ctx: OrgContext,
  input: unknown,
): Promise<ActionResult & { data?: SiteTeamCandidatesPage }> {
  if (!can(ctx.role, 'site_assignments', 'create')) return err('forbidden');
  if (!isCandidateSearch(input)) return err('malformed');
  try {
    const page = await listSiteTeamCandidatePage(ctx, input.projectId, {
      offset: input.offset,
      limit: SITE_TEAM_CANDIDATES_PER_CALL,
    });
    if (!page) return err('project_not_found');
    const query = cleanSearchQuery(input.query, MAX_CANDIDATE_SEARCH_LENGTH);
    const people = await withIdentities(page.candidates, { withEmail: true });
    return {
      ok: true,
      data: {
        candidates: people.filter((person) => matchesMemberSearch(person, query)),
        nextOffset: page.hasMore ? input.offset + SITE_TEAM_CANDIDATES_PER_CALL : null,
      },
    };
  } catch (error) {
    return unexpectedFailure('site team candidate search failed', error);
  }
}
