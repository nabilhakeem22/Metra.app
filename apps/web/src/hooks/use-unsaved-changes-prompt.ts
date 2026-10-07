'use client';

import { useEffect } from 'react';

/**
 * While `active`, closing or reloading the tab asks first (the browser's own
 * "Leave site?" prompt; its wording is the browser's, not ours).
 */
export function useUnsavedChangesPrompt(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}
