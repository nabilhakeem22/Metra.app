import type { ReactNode } from 'react';

/**
 * A document number (PR-2026-0001, C-2026-0004) inside a sentence: isolated
 * left to right and never broken across lines, so a narrow right-to-left
 * screen never shows "PR-2026-" on one line and "0001" on the next (B4 F5).
 */
export function DocumentNumber({ children }: { children: ReactNode }) {
  return (
    <bdi dir="ltr" className="whitespace-nowrap">
      {children}
    </bdi>
  );
}
