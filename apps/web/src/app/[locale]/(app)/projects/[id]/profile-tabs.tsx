'use client';

import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Link, useRouter } from '@/i18n/routing';
import { cn } from '@/lib/utils';
import { PROJECT_TABS, type ProjectTab } from './tabs';

/**
 * Deep-linkable project-profile tabs. ARIA tablist over next/link hrefs (?tab=…),
 * roving tabindex, arrow/Home/End keyboard nav. Logical CSS only (flips in RTL
 * automatically — Arrow keys follow document order, not physical left/right).
 */
export function ProfileTabs({
  projectId,
  active,
}: {
  projectId: string;
  active: ProjectTab;
}) {
  const t = useTranslations('projects.profile.tabs');
  const router = useRouter();
  const refs = useRef<Array<HTMLAnchorElement | null>>([]);

  const href = (tab: ProjectTab) => `/projects/${projectId}?tab=${tab}`;

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = PROJECT_TABS.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next < 0) return;
    e.preventDefault();
    refs.current[next]?.focus();
    router.push(href(PROJECT_TABS[next]));
  }

  return (
    <div
      role="tablist"
      aria-label={t('sectionsLabel')}
      className="flex flex-wrap gap-1 border-b"
    >
      {PROJECT_TABS.map((tab, i) => {
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
