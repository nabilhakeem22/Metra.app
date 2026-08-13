'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { CLIENT_TABS, type ClientTab } from './tabs';

/**
 * Deep-linkable client-profile tabs. ARIA tablist over next/link hrefs (?tab=…),
 * roving tabindex, arrow/Home/End keyboard nav. Logical CSS only (flips in RTL
 * automatically — Arrow keys follow document order, not physical left/right).
 */
export function ProfileTabs({
  clientId,
  active,
}: {
  clientId: string;
  active: ClientTab;
}) {
  const t = useTranslations('clients.profile.tabs');
  const router = useRouter();
  const refs = useRef<Array<HTMLAnchorElement | null>>([]);

  const href = (tab: ClientTab) => `/clients/${clientId}?tab=${tab}`;

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = CLIENT_TABS.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    router.push(href(CLIENT_TABS[next]));
  }

  return (
    <div
      role="tablist"
      aria-label={t('sectionsLabel')}
      className="flex flex-wrap gap-1 border-b"
    >
      {CLIENT_TABS.map((tab, i) => {
        const selected = tab === active;
        return (
          <Link
            key={tab}
            ref={(el) => {
              refs.current[i] = el;
            }}
            href={href(tab)}
            role="tab"
            id={`tab-${tab}`}
            aria-selected={selected}
            aria-controls={`panel-${tab}`}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              'border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t(tab)}
          </Link>
        );
      })}
    </div>
  );
}
