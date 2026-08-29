'use client';

import { Link2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { EngagementHeader } from '@/lib/engagements/queries';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { pickLocale } from '@/lib/i18n/pick-locale';

// The cockpit HEADER ROW (mockup "headrow") — a mono, bordered number pill
// (DE-YYYY-NNNN) + a "who" line (client name bold · project name, muted) + a
// client-link chip pinned to the inline-END: a success pill "Client link active"
// with a link glyph when a share link is live, else a muted "Not shared". The
// `shared` flag reuses the page's existing delivery share status — no new query.
// Any real header state the mockup omits (off-plan / as-built due / concept
// locked / render manifest) is retained as a secondary muted chip row so no
// signal is lost. Logical CSS only (inline-start/end) so it mirrors in ar-EG RTL.
export function EngagementHeaderCard({
  header,
  shared,
}: {
  header: EngagementHeader;
  shared: boolean;
}) {
  const t = useTranslations('engagements');
  const tc = useTranslations('engagements.command');
  const locale = useLocale();

  const client =
    pickLocale({ nameAr: header.clientNameAr, nameEn: header.clientNameEn }, 'name', locale)
      .value || '—';
  const project =
    pickLocale({ nameAr: header.projectNameAr, nameEn: header.projectNameEn }, 'name', locale)
      .value || '—';
  const docNumber = formatDocNumber(
    'DE',
    header.number,
    docYear(null, header.createdAt),
  );

  const flags = [
    header.offPlan && { key: 'offPlan', label: t('offPlan.offPlan'), tone: 'muted' as const },
    header.asBuiltDue && {
      key: 'asBuiltDue',
      label: t('asBuiltDue'),
      tone: 'warn' as const,
    },
    header.conceptLockedAt && {
      key: 'conceptLocked',
      label: t('conceptLocked'),
      tone: 'brand' as const,
    },
  ].filter(Boolean) as { key: string; label: string; tone: 'muted' | 'warn' | 'brand' }[];

  return (
    <header className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        {/* `contents` keeps the h1 out of the box tree so the number pill and the
            "who" line stay direct flex children (mockup `.headrow`). */}
        <h1 className="contents">
          <span
            className="rounded-[var(--r-item)] border border-[color:var(--rule)] bg-card px-2.5 py-1.5 font-mono text-[13px] font-semibold tracking-[0.01em] text-[color:var(--text)] shadow-sm tabular-nums"
            dir="ltr"
          >
            {docNumber}
          </span>

          <span className="min-w-0 text-[14px] font-normal text-[color:var(--text-muted)]">
            <span className="font-semibold text-[color:var(--text)]">{client}</span>
            <span aria-hidden> · </span>
            <span>{project}</span>
          </span>
        </h1>

        <span
          className={`ms-auto inline-flex items-center gap-1.5 rounded-[var(--r-pill)] px-3 py-1.5 text-[12px] font-semibold ${
            shared
              ? 'border border-[color:var(--success)] bg-[color:var(--success-tint)] text-[color:var(--success)]'
              : 'border border-[color:var(--rule)] bg-[color:var(--track)] text-[color:var(--text-muted)]'
          }`}
        >
          {shared && <Link2 className="size-3.5" aria-hidden />}
          {shared ? tc('clientLinkActive') : tc('clientLinkInactive')}
        </span>
      </div>

      {(flags.length > 0 || header.renderManifestHash) && (
        <div className="flex flex-wrap gap-2">
          {flags.map((flag) => (
            <span
              key={flag.key}
              className={`rounded-full px-2 py-0.5 text-xs ${
                flag.tone === 'warn'
                  ? 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]'
                  : flag.tone === 'brand'
                    ? 'bg-brand-tint text-brand-ink'
                    : 'bg-[color:var(--track)] text-[color:var(--text-muted)]'
              }`}
            >
              {flag.label}
            </span>
          ))}
          {header.renderManifestHash && (
            <span
              className="rounded-full bg-[color:var(--track)] px-2 py-0.5 font-mono text-xs text-[color:var(--text-muted)]"
              dir="ltr"
              title={header.renderManifestHash}
            >
              {t('renderManifest')}: {header.renderManifestHash.slice(0, 10)}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
