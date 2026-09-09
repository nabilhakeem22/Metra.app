'use client';

import { Ruler } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import { romHistory } from '@/lib/engagements/rom-history';
import type {
  EngagementEventRecord,
  EngagementHeader,
} from '@/lib/engagements/queries';
import { formatDate } from '@/lib/format/date';
import { formatMoney } from '@/lib/format/money';
import { PanelHeader } from './engagement-panel-header';
import { Empty } from './engagement-panels-parts';
import { RomRangeForm } from './engagement-rom-range-form';

/**
 * The Budget tab — the indicative build cost, as a ledger rather than a number.
 *
 * It exists because the range is not one value. It is coarse first, tighter as
 * the design firms up, acknowledged at the gate that unlocks shop drawings, and
 * eventually superseded by the priced BOQ. A studio's entire exposure on a
 * non-binding figure is the question "what did we tell them, and when" — and a
 * single overwritable pair of columns cannot answer it. So superseded ranges stay
 * on the page: that history IS the protection.
 *
 * "Not a quote" sits in the header, not in a tooltip. The whole non-binding
 * posture rests on the client having demonstrably been shown it.
 */
export function BudgetTab({
  engagementId,
  header,
  events,
  canSetRom,
  pending,
  runAction,
}: {
  engagementId: string;
  header: EngagementHeader;
  events: EngagementEventRecord[];
  canSetRom: boolean;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const t = useTranslations('engagements');
  const tp = useTranslations('engagements.panels');
  const tpa = useTranslations('engagements.panelActions');
  const locale = useLocale();
  const [formOpen, setFormOpen] = useState(false);

  const hasRange = header.romLow !== null && header.romHigh !== null;
  const entries = romHistory(events);

  return (
    <div>
      <PanelHeader
        title={tp('budget')}
        sub={tpa('rangeNote')}
        actions={
          canSetRom && (
            <Button
              type="button"
              size="sm"
              disabled={pending}
              onClick={() => setFormOpen((open) => !open)}
              aria-expanded={formOpen}
            >
              <Ruler className="size-4" aria-hidden />
              {hasRange ? tpa('reviseRange') : tpa('setRange')}
            </Button>
          )
        }
      />
      <div className="space-y-5 p-4">
        {formOpen && (
          <RomRangeForm
            engagementId={engagementId}
            pending={pending}
            runAction={runAction}
            onDone={() => setFormOpen(false)}
          />
        )}

        {/* The CURRENT band, stated once and large. Everything below it is what
            it used to be. */}
        <div className="flex flex-wrap items-baseline gap-3 rounded-[var(--r-item)] border border-[color:var(--rule)] bg-[color:var(--track)] px-4 py-3.5">
          <span className="text-[12.5px] text-[color:var(--text-muted)]">
            {t('rom.range')}
          </span>
          {hasRange ? (
            // A range is ONE value, formatted as one unit — never two numbers with
            // a hyphen glued between them, which mirrors wrong in RTL.
            <span
              className="ms-auto font-mono text-[16px] tabular-nums"
              dir="ltr"
            >
              {`${formatMoney(header.romLow, locale)} – ${formatMoney(header.romHigh, locale)}`}
            </span>
          ) : (
            <span className="ms-auto text-[13px] text-[color:var(--text-muted)]">
              {t('rom.notSet')}
            </span>
          )}
        </div>

        <div>
          <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--text-muted)]">
            {tp('budgetHistory')}
          </p>
          {entries.length === 0 ? (
            <Empty text={t('rom.noHistory')} />
          ) : (
            <ul className="m-0 list-none p-0">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-dashed border-[color:var(--rule)] py-2.5 last:border-0"
                >
                  <span className="text-[13px] font-medium">
                    {t(`eventKind.${entry.kind}`)}
                  </span>
                  <span
                    className="font-mono text-[11px] text-[color:var(--text-faint)]"
                    dir="ltr"
                  >
                    {formatDate(entry.at, locale)}
                  </span>
                  <span
                    className="ms-auto font-mono text-[13px] tabular-nums"
                    dir="ltr"
                  >
                    {`${formatMoney(entry.low, locale)} – ${formatMoney(entry.high, locale)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
