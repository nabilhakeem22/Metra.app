'use client';

// Shared building blocks for the engagement detail panels — the empty-state line
// and the mono-money / table-head-row class recipes. Extracted so the tab-body
// panels (payments · artifacts · change orders · rom) and the pinned right-rail
// panels (fee · timeline) share one source without a circular import.

export function Empty({ text }: { text: string }) {
  return <p className="py-3 text-sm text-[color:var(--text-muted)]">{text}</p>;
}

export const MONEY = 'text-end font-mono tabular-nums';

export const HEAD_ROW =
  'border-b border-[color:var(--rule)] text-xs text-[color:var(--text-faint)]';
