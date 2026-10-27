'use client';

import { useEffect } from 'react';
import type { HomeFocus } from '@/lib/client-home/tab';

/**
 * The element a focus names, by the id the Execution tab gives it: the
 * contract section, a payment request's row (`request-<id>`), a change order's
 * row (`variation-<id>`), the contract's signing (`sign-<id>`). Null when the
 * page does not show it, and for a design-fee instalment (the design tab's).
 */
function targetOf(focus: HomeFocus): HTMLElement | null {
  if (focus.section === 'instalment') return null;
  return document.getElementById(focus.section === 'contract' ? 'contract' : `${focus.section}-${focus.id}`);
}

/**
 * Scroll the Execution tab to what a link's `?focus=` names, once, when the
 * page opens, and only when the page shows it: a request of another delivery,
 * one beyond the newest 60, or a change order (the tab lists none of them by
 * id yet) leaves the page at its top. An unknown focus is ignored.
 */
export function useFocusSection(focus: HomeFocus | null): void {
  useEffect(() => {
    if (focus) targetOf(focus)?.scrollIntoView({ block: 'start' });
    // Once per page open: a re-render after a claim must not scroll the page back.
  }, []);
}
