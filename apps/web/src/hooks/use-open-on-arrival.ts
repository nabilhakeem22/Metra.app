'use client';

import { useEffect, useRef } from 'react';

/**
 * Open a page's create sheet ONCE when the page was reached through a deep link
 * (`?new=1`, or the client profile's `?newFor=`). `shouldOpen` must already
 * include the same permission check the page's own "New" button uses, so a link
 * never opens a form the server would refuse. The ref keeps a later re-render
 * (a refresh after saving, say) from opening it again.
 */
export function useOpenOnArrival(shouldOpen: boolean, open: () => void): void {
  const opened = useRef(false);
  useEffect(() => {
    if (!shouldOpen || opened.current) return;
    opened.current = true;
    open();
  }, [shouldOpen, open]);
}
