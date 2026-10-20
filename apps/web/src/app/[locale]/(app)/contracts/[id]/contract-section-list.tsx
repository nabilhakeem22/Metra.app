'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useRouter } from '@/i18n/routing';
import { describeReadFailure, type ShownFailure } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';
import { loadContractSections, loadSectionLines } from '@/lib/contracts/lines-actions';
import type { ContractSectionSummary } from '@/lib/contracts/queries';
import { formatNumber } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { KeptSectionLines } from './use-kept-section-lines';
import type { KeptSections } from './use-kept-sections';

/** Why the last ask failed; `gone` when the contract is not this workspace's to show any more. */
interface ReadFailure {
  message: string;
  gone: boolean;
}

/** The key of the list's own ask; a section's lines are asked under the section's id. */
const SECTIONS = 'sections';

/**
 * The contract's sections on its page, as ONE list (A3 reliability R1): a page
 * of 50 sections at a time ("show more sections"), each with its title,
 * subtotal, the lines shown so far and "show lines" while more remain (a page
 * at a time). Every section renders inside this one component, so the page's
 * size and work follow the 50 sections shown, never the contract's total.
 * One ask at a time per section and for the list; a failed ask keeps what is
 * shown and says why under the button that made it, with a way to reload the
 * page when the contract is not this workspace's any more.
 */
export function ContractSectionList({
  contractId,
  sections,
  lines,
  m,
}: {
  contractId: string;
  sections: KeptSections;
  lines: KeptSectionLines;
  m: (v: string) => string;
}) {
  const t = useTranslations('contracts.lines');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [asking, setAsking] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, ReadFailure>>({});
  const inFlight = useRef(new Set<string>());
  const pick = (ar: string | null, en: string | null) => pickLocale({ nameAr: ar, nameEn: en }, 'name', locale).value;

  /** One ask under `key`, at most one at a time; its answer kept, or its failure said under its button. */
  function ask<T>(key: string, run: () => Promise<ActionResult & { data?: T }>, keep: (data: T) => void) {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setAsking(key);
    setFailures(({ [key]: _cleared, ...rest }) => rest);
    const fail = (shown: ShownFailure) => {
      const gone = 'error' in shown && shown.error === 'record_not_found';
      const message = gone ? t('gone') : describeReadFailure(shown, te, t(key === SECTIONS ? 'loadSectionsFailed' : 'loadFailed'));
      setFailures((current) => ({ ...current, [key]: { message, gone } }));
    };
    startTransition(async () => {
      try {
        const result = await run();
        if (result.ok && result.data) keep(result.data);
        else fail(result);
      } catch (rejection) {
        fail({ rejection });
      } finally {
        inFlight.current.delete(key);
      }
    });
  }

  const afterSectionId = sections.page?.sections.at(-1)?.id ?? null;
  const moreSections = () => ask(SECTIONS, () => loadContractSections({ contractId, afterSectionId }), sections.append);

  // The page opened on another tab: the overview asks for its first sections
  // when it is shown. Once, on mount; the kept page outlives the tab after that.
  const opened = useRef(sections.page !== null);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    moreSections();
  });

  function linesOf(section: ContractSectionSummary) {
    return lines.of(section.id) ?? { lines: section.openingLines, hasMore: section.openingLines.length < section.lineCount };
  }

  function moreLines(section: ContractSectionSummary) {
    const shown = linesOf(section);
    const afterLineId = shown.lines.at(-1)?.id ?? null;
    ask(
      section.id,
      () => loadSectionLines({ contractId, sectionId: section.id, afterLineId }),
      (page) => lines.keep(section.id, { lines: [...shown.lines, ...page.lines], hasMore: page.hasMore }),
    );
  }

  function failureOf(key: string) {
    const failure = failures[key];
    if (!failure) return null;
    return (
      <>
        <p className="text-body text-destructive" role="alert">
          {failure.message}
        </p>
        {failure.gone && (
          <Button size="sm" variant="secondary" onClick={() => router.refresh()}>
            {t('reload')}
          </Button>
        )}
      </>
    );
  }

  function section(summary: ContractSectionSummary) {
    const shown = linesOf(summary);
    const busy = pending && asking === summary.id;
    const remaining = Math.max(summary.lineCount - shown.lines.length, 0);
    return (
      <Card key={summary.id}>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-body font-semibold">{pick(summary.titleAr, summary.titleEn)}</h2>
            <span className="text-body" dir="ltr">
              {m(summary.sectionSubtotal)}
            </span>
          </div>
          {shown.lines.length > 0 && (
            <table className="w-full text-body">
              <tbody>
                {shown.lines.map((line) => (
                  <tr key={line.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{pick(line.descriptionAr, line.descriptionEn)}</td>
                    <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                      {line.qty} {line.unit}
                    </td>
                    <td className="px-4 py-2 text-end" dir="ltr">
                      {m(line.unitPrice)}
                    </td>
                    <td className="px-4 py-2 text-end" dir="ltr">
                      {m(line.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {shown.hasMore && (
            <div className="space-y-2 border-t px-4 py-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => moreLines(summary)}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {t(shown.lines.length > 0 ? 'showMore' : 'show', { count: formatNumber(remaining, locale) })}
              </Button>
              {failureOf(summary.id)}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const listBusy = pending && asking === SECTIONS;
  return (
    <div className="space-y-4">
      {sections.page?.sections.map(section)}
      {sections.page === null && listBusy && (
        <p className="flex items-center gap-2 text-body text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t('loadingSections')}
        </p>
      )}
      {(sections.page === null ? !listBusy && SECTIONS in failures : sections.page.hasMore) && (
        <div className="space-y-2">
          <Button size="sm" variant="secondary" disabled={listBusy} onClick={moreSections}>
            {listBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('moreSections')}
          </Button>
          {failureOf(SECTIONS)}
        </div>
      )}
    </div>
  );
}
