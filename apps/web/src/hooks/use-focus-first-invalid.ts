'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Each time `attempt` moves (a submit came back with field errors), put the
 * caret in the first refused control inside `ref`, in DOM order, and bring it
 * into view. Its `aria-describedby` then reads the refusal. Attempt 0 is the
 * untouched form, so opening never steals focus.
 */
export function useFocusFirstInvalid(ref: RefObject<HTMLElement | null>, attempt: number): void {
  useEffect(() => {
    if (attempt <= 0) return;
    const first = ref.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!first) return;
    first.focus();
    first.scrollIntoView({ block: 'center' });
  }, [ref, attempt]);
}
