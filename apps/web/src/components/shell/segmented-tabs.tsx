'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

// Leading-side segmented control on the top bar. The tabs are shell chrome; the
// content they scope is wired in a later slice, so selection is local state and
// the first tab is active by default. Pill track with a sliding glass thumb.
const TAB_KEYS = ['overview', 'activity'] as const;
type TabKey = (typeof TAB_KEYS)[number];

export function SegmentedTabs() {
  const shell = useTranslations('shell');
  const [active, setActive] = useState<TabKey>('overview');

  return (
    <div
      role="group"
      aria-label={shell('viewTabs')}
      className="inline-flex gap-[2px] rounded-full p-[3px]"
      style={{ background: 'var(--track)' }}
    >
      {TAB_KEYS.map((key) => {
        const isActive = key === active;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={isActive}
            onClick={() => setActive(key)}
            className="rounded-full px-[14px] py-[6px] text-[13px] transition-colors motion-reduce:transition-none"
            style={
              isActive
                ? {
                    fontWeight: 700,
                    color: 'var(--text)',
                    background: 'var(--glass-strong)',
                    boxShadow: '0 1px 3px rgba(23,34,57,.14)',
                  }
                : { fontWeight: 500, color: 'var(--text-muted)' }
            }
          >
            {shell(key)}
          </button>
        );
      })}
    </div>
  );
}
