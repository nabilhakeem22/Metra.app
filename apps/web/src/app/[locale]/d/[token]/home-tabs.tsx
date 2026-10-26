'use client';

import { Check, Hammer } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { homeHref, type HomeTab } from '@/lib/client-home/tab';
import { tokenPathSegment } from '@/lib/engagements/portal-path';

/**
 * The client home's two phases once the design is behind the job: the
 * Execution tab, the current phase and the primary one, and the finished
 * design as a quiet record, a tick beside its name. Only a delivery that
 * started with a design shows it (a light delivery has only its Execution
 * tab). Plain links, each a full read of its own tab (./home-read.ts), never
 * prefetched; 44 px tall at least. Logical CSS only, so it mirrors in RTL.
 */
export function HomeTabs({ token, current }: { token: string; current: HomeTab }) {
  const t = useTranslations('delivery.home.tabs');
  const segment = tokenPathSegment(token);
  const tabs = [
    { tab: 'execution', label: t('execution'), note: t('executionNote'), Icon: Hammer },
    { tab: 'design', label: t('design'), note: t('designNote'), Icon: Check },
  ] as const;

  return (
    <nav aria-label={t('label')}>
      <ul className="grid grid-cols-2 gap-1.5 rounded-panel bg-[color:var(--track)] p-1.5">
        {tabs.map(({ tab, label, note, Icon }) => {
          const selected = tab === current;
          return (
            <li key={tab}>
              <Link
                href={homeHref(segment, tab)}
                prefetch={false}
                aria-current={selected ? 'page' : undefined}
                className={`flex min-h-11 items-center gap-2.5 rounded-item px-2.5 py-2 outline-none focus-ring-brand ${
                  selected ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/60'
                }`}
              >
                <span
                  aria-hidden
                  className={`grid size-7 shrink-0 place-items-center rounded-full ${
                    tab === 'design' ? 'bg-[color:var(--success-tint)] text-[color:var(--success)]' : 'bg-primary/15 text-primary'
                  }`}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className={`block truncate text-body ${selected ? 'font-bold' : 'font-semibold'}`}>{label}</span>
                  <span className="block truncate text-caption">{note}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
