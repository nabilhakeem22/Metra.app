'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { describeReadFailure, type ShownFailure } from '@/lib/actions/error-message';
import { searchSiteTeamCandidates } from '@/lib/site/assignments/actions';
import { SITE_TEAM_CANDIDATES_PER_CALL, type SiteTeamPerson } from '@/lib/site/assignments/types';

/** How long typing rests before the server is asked: one request per pause. */
const SEARCH_PAUSE_MS = 200;

interface Answer {
  query: string;
  candidates: SiteTeamPerson[];
  nextOffset: number | null;
  failure: string | null;
}

/**
 * Ask from `offset` on until a page's worth of matches was added after `shown`
 * or every candidate was looked at. Each call is its own request, looking up
 * at most one page of members (the server's bound); a typed search that
 * matches few people walks on by itself. `superseded` stops the walk when a
 * newer question was asked.
 */
async function askFrom(
  projectId: string,
  query: string,
  offset: number,
  shown: SiteTeamPerson[],
  superseded: () => boolean,
  describe: (failure: ShownFailure) => string,
): Promise<Answer> {
  const candidates = [...shown];
  let next: number | null = offset;
  try {
    while (next !== null && candidates.length - shown.length < SITE_TEAM_CANDIDATES_PER_CALL && !superseded()) {
      const result = await searchSiteTeamCandidates({ projectId, query, offset: next });
      if (!result.ok || !result.data) return { query, candidates, nextOffset: next, failure: describe(result) };
      candidates.push(...result.data.candidates);
      next = result.data.nextOffset;
    }
    return { query, candidates, nextOffset: next, failure: null };
  } catch (rejection) {
    return { query, candidates, nextOffset: next, failure: describe({ rejection }) };
  }
}

const NO_CANDIDATES: SiteTeamPerson[] = [];

/**
 * The members a manager may add to the project's site team, asked of the
 * server ON DEMAND: nothing is asked until `active` (the manager reached the
 * add form), then a page for what is typed (everyone while nothing is).
 * "More" asks for the next page (or again, after a failure). `teamKey` names who is on the team: when it
 * changes (someone added or taken off), the list is asked again. An answer
 * that lands after a newer question is dropped.
 */
export function useSiteTeamCandidates(projectId: string, query: string, active: boolean, teamKey: string) {
  const t = useTranslations('projects.profile.team');
  const te = useTranslations('errors');
  // Read when an answer lands, so a new translator never re-asks the server.
  const describe = useRef((failure: ShownFailure) => describeReadFailure(failure, te, t('candidatesFailed')));
  useEffect(() => {
    describe.current = (failure) => describeReadFailure(failure, te, t('candidatesFailed'));
  });
  const question = useRef(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    if (!active) return;
    const asked = ++question.current;
    const superseded = () => question.current !== asked;
    const timer = setTimeout(
      () => askFrom(projectId, query, 0, [], superseded, describe.current).then((next) => !superseded() && setAnswer(next)),
      query.trim() === '' ? 0 : SEARCH_PAUSE_MS,
    );
    return () => clearTimeout(timer);
  }, [projectId, query, active, teamKey]);

  const current = answer !== null && answer.query === query ? answer : null;

  function loadMore(): void {
    if (loadingMore || current === null || current.nextOffset === null) return;
    const asked = question.current;
    const superseded = () => question.current !== asked;
    setLoadingMore(true);
    askFrom(projectId, query, current.nextOffset, current.candidates, superseded, describe.current)
      .then((next) => !superseded() && setAnswer(next))
      .finally(() => setLoadingMore(false));
  }

  /** Take a member off the list now (the server said he may no longer join). */
  function drop(userId: string): void {
    setAnswer((shown) => shown && { ...shown, candidates: shown.candidates.filter((person) => person.userId !== userId) });
  }

  return {
    candidates: current?.candidates ?? NO_CANDIDATES,
    /** True from the first question until its answer lands. */
    loading: active && current === null,
    /** An answer for what is typed has landed (nothing is said of the list before). */
    answered: current !== null,
    /** More to ask for; after a failure, asking again retries from where it stopped. */
    hasMore: current !== null && current.nextOffset !== null,
    loadMore,
    loadingMore,
    failure: current?.failure ?? null,
    drop,
  };
}
