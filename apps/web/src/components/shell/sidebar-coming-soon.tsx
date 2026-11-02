'use client';

import { ChevronRight } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { COMING_SOON_ITEMS } from './nav-items';
import { ITEM_CLASS } from './sidebar-item-styles';

// The coming-soon disclosure at the end of the main nav group: a toggle button
// and, when open, the disabled "soon" rows. The parent owns the open state.
export function SidebarComingSoon({
  open,
  onToggle,
  nav,
}: {
  open: boolean;
  onToggle: () => void;
  nav: ReturnType<typeof useTranslations<'nav'>>;
}) {
  return (
    <div className="mt-[3px] flex flex-col gap-[3px]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          ITEM_CLASS,
          'w-full font-medium text-[color:var(--text-muted)] hover:bg-[color:var(--track)] hover:text-[color:var(--text)]',
        )}
      >
        <ChevronRight
          width={15}
          height={15}
          className={cn(
            'shrink-0 transition-transform motion-reduce:transition-none rtl:-scale-x-100',
            open && 'rotate-90',
          )}
          aria-hidden
        />
        <span className="flex-1 truncate text-start">{nav('comingSoon')}</span>
      </button>

      {open &&
        COMING_SOON_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <span
              key={item.key}
              aria-disabled
              className={cn(
                ITEM_CLASS,
                'ms-4 cursor-not-allowed font-medium text-[color:var(--text-faint)]',
              )}
            >
              <Icon width={17} height={17} className="shrink-0" aria-hidden />
              <span className="flex-1 truncate">{nav(item.key)}</span>
              <span
                className="rounded-pill px-2 py-0.5 text-caption font-medium"
                style={{
                  background: 'var(--track)',
                  color: 'var(--text-faint)',
                }}
              >
                {nav('soon')}
              </span>
            </span>
          );
        })}
    </div>
  );
}
