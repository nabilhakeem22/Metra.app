'use client';

import { Link2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { EngagementHeader } from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';

// The cockpit HEADER — breadcrumb and document number on a quiet mono line, the
// engagement named at display weight, then a chip row of what is true about it,
// with the share state pinned to the inline-END.
//
// The number moved OUT of a bordered pill and into the breadcrumb. It was
// competing with the client's name for first read, and the client's name is what
// a studio actually scans a list of engagements for.
//
// Every chip is derived from data this product HOLDS. The design mockup this
// follows also drew a delivery-branch chip and an assignee, and neither is built:
// the branch is not decided until `execution_decision` (six stages after the one
// the mockup illustrates) and there is no assignee column on `design_engagements`.
// Inventing them would put two confident falsehoods at the top of the page.
//
// `shared` reuses the page's existing delivery share status — no new query.
// Logical CSS only (inline-start/end) so it mirrors in ar-EG RTL.
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
  const started = formatDate(header.createdAt, locale);
  const feeLabel = header.designFee
    ? tc('feeChip', { amount: formatMoney(header.designFee, locale) })
    : null;

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

  // The chips the mockup draws that this product does NOT model, and so are not
  // invented here: the delivery BRANCH ("Design + execution") is not decided until
  // `execution_decision`, six stages after the Concept the mockup shows, and there
  // is no assignee column on design_engagements at all, so the owner chip has no
  // source. The real flags take their place -- off-plan, as-built due, concept
  // locked -- which are true and which the mockup had no way to know about.
  const chips = [
    feeLabel && { key: 'fee', label: feeLabel, tone: 'muted' as const },
    { key: 'started', label: tc('startedOn', { date: started }), tone: 'muted' as const },
    ...flags,
  ].filter(Boolean) as { key: string; label: string; tone: 'muted' | 'warn' | 'brand' }[];

  return (
    <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
      <div className="min-w-0 flex-1">
        {/* Breadcrumb + document number on one mono line: where you are, and which
            record this is. The number was a bordered pill of its own; here it earns
            less weight than the client's name, which is what a studio scans for. */}
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-faint)]">
          <span>{tc('crumb')}</span>
          <span aria-hidden> / </span>
          <span dir="ltr">{docNumber}</span>
        </p>
        <h1 className="mt-1 text-[20px] font-extrabold leading-tight tracking-[var(--tracking-title)] text-[color:var(--text)] text-balance">
          {client}
          <span aria-hidden> — </span>
          <span className="font-bold">{project}</span>
        </h1>
        {chips.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className={`rounded-[var(--r-pill)] px-2.5 py-0.5 text-[11.5px] font-semibold ${
                  chip.tone === 'warn'
                    ? 'bg-[color:var(--warn-tint)] text-[color:var(--warn)]'
                    : chip.tone === 'brand'
                      ? 'bg-brand-tint text-brand-ink'
                      : 'bg-[color:var(--track)] text-[color:var(--text-muted)]'
                }`}
              >
                {chip.label}
              </span>
            ))}
            {header.renderManifestHash && (
              <span
                className="rounded-[var(--r-pill)] bg-[color:var(--track)] px-2.5 py-0.5 font-mono text-[11.5px] font-semibold text-[color:var(--text-muted)]"
                dir="ltr"
                title={header.renderManifestHash}
              >
                {t('renderManifest')}: {header.renderManifestHash.slice(0, 10)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* The share state keeps its own corner, as the mockup draws it. It stays a
          STATUS rather than becoming a button: the control that reveals the link
          lives on the command card, and two of them would be the duplication this
          whole restructure exists to remove. */}
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-[var(--r-pill)] px-3 py-1.5 text-[12.5px] font-semibold ${
          shared
            ? 'border border-[color:var(--success)] bg-[color:var(--success-tint)] text-[color:var(--success)]'
            : 'border border-[color:var(--rule)] bg-[color:var(--track)] text-[color:var(--text-muted)]'
        }`}
      >
        {shared && <Link2 className="size-3.5" aria-hidden />}
        {shared ? tc('clientLinkActive') : tc('clientLinkInactive')}
      </span>
    </header>
  );
}
