'use client';

import { useRef } from 'react';

/**
 * Focus goes back to whatever opened a dialog when it closes (fix round F4).
 * The portal's dialogs are controlled, with no Radix Trigger, so Radix's own
 * return target is null and focus fell to the page body. Spread the two
 * handlers on the dialog's Content: the opener is remembered just before Radix
 * moves focus in, and refocused on close while it is still on the page (an
 * opener the refresh replaced lets Radix do its default).
 */
export function useReturnFocus(): {
  onOpenAutoFocus: () => void;
  onCloseAutoFocus: (event: Event) => void;
} {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event) => {
      const element = opener.current;
      opener.current = null;
      if (element?.isConnected) {
        event.preventDefault();
        element.focus();
      }
    },
  };
}
