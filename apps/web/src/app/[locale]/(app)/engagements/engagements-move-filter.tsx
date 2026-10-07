'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';

/**
 * "All" or "My move": two links, so the choice lives in the URL
 * (`/engagements?move=mine`) and survives a reload or a shared link. The current
 * one carries `aria-current`.
 */
export function EngagementsMoveFilter({ mine }: { mine: boolean }) {
  const t = useTranslations('engagements.list.filter');
  const options = [
    { key: 'all', href: '/engagements', active: !mine },
    { key: 'mine', href: '/engagements?move=mine', active: mine },
  ] as const;
  return (
    <nav aria-label={t('label')} className="flex gap-1">
      {options.map((option) => (
        <Link
          key={option.key}
          href={option.href}
          aria-current={option.active ? 'page' : undefined}
          className={`inline-flex items-center rounded-pill px-3 py-1.5 text-small font-semibold outline-none focus-ring-brand coarse:min-h-11 ${
            option.active
              ? 'bg-brand-tint text-brand-ink'
              : 'text-[color:var(--text-muted)] hover:bg-[color:var(--track)] hover:text-[color:var(--text)]'
          }`}
        >
          {t(option.key)}
        </Link>
      ))}
    </nav>
  );
}
