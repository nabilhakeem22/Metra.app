'use client';

import { useEffect, useRef } from 'react';

/**
 * When the team changes under a focused row (it was taken off), the focus
 * would fall to the page: it lands on the returned element (the card's title)
 * instead. Only on a change of `teamKey`, never on the first render, and never
 * when the focus is somewhere else.
 */
export function useFocusLandingOnTeamChange(teamKey: string) {
  const landing = useRef<HTMLHeadingElement>(null);
  const shownTeam = useRef(teamKey);
  useEffect(() => {
    if (shownTeam.current === teamKey) return;
    shownTeam.current = teamKey;
    if (document.activeElement === null || document.activeElement === document.body) landing.current?.focus();
  }, [teamKey]);
  return landing;
}
