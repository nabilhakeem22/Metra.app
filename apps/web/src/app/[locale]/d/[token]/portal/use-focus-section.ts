'use client';

import { useEffect } from 'react';
import type { HomeFocus } from '@/lib/client-home/tab';

/** The element a focus names: a payment request's row when it is listed, else its section. */
function targetOf(focus: HomeFocus): HTMLElement | null {
  if (focus.section === 'contract') return document.getElementById('contract');
  if (focus.section === 'variation') return document.getElementById('change-orders');
  return document.getElementById(`request-${focus.id}`) ?? document.getElementById('payments');
}

/**
 * Scroll the Execution tab to the section a link's `?focus=` names, once, when
 * the page opens. A section the page does not show (a change order already
 * decided, a request beyond the newest 60) leaves the page at its top: an
 * unknown focus is ignored.
 */
export function useFocusSection(focus: HomeFocus | null): void {
  useEffect(() => {
    if (focus) targetOf(focus)?.scrollIntoView({ block: 'start' });
    // Once per page open: a re-render after a claim must not scroll the page back.
  }, []);
}
