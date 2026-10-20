'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PortalFailureAlert } from '@/components/share/portal-failure-alert';
import type { PublicContractLine, PublicContractSection } from '@/lib/contracts/public-types';
import { formatMoney } from '@/lib/format/money';
import { formatQuantity } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ShownPortalFailure } from '@/lib/share/portal-failure';
import { loadContractSectionLines, loadContractSections } from './actions';

/** What a "show more" left on screen: a shared portal failure, or this page's own sentence. */
type LoadProblem = { failure: ShownPortalFailure } | { own: 'gone' | 'loadFailed' | 'loadSectionsFailed' };

/** The key of the list's own ask; a section's lines are asked under the section's id. */
const SECTIONS = 'sections';

/**
 * The contract's sections on /c, as ONE list (A3 reliability R1): the first 50
 * sections open with the page, holding the first 50 lines of the contract
 * between them; "show more sections" adds the next 50, collapsed; each section
 * shows its subtotal, the lines shown so far and "show lines" for the rest, 100
 * at a time. Every request spends the link's read budget. Every section renders
 * inside this one component, so the page follows the sections shown, never the
 * contract's total. A failed ask keeps what is shown and says why, in فصحى,
 * under the button that made it.
 */
export function ContractSectionList({
  token,
  sections: opening,
  sectionCount,
}: {
  token: string;
  sections: PublicContractSection[];
  sectionCount: number;
}) {
  const t = useTranslations('contracts.ack.lines');
  const locale = useLocale();
  const [sections, setSections] = useState<PublicContractSection[]>(opening);
  const [lines, setLines] = useState<Record<string, PublicContractLine[]>>(() =>
    Object.fromEntries(opening.map((section) => [section.id, section.lines])),
  );
  const [problems, setProblems] = useState<Record<string, LoadProblem>>({});
  const [asking, setAsking] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(new Set<string>());
  const text = (ar: string | null, en: string | null) => pickLocale({ textAr: ar, textEn: en }, 'text', locale).value;

  /** One ask under `key`, at most one at a time; its answer kept, or its problem said. */
  function ask<P>(
    key: string,
    run: () => Promise<{ ok: true; page: P } | { ok: false; error: string; reference?: string }>,
    keep: (page: P) => void,
  ) {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setAsking(key);
    setProblems(({ [key]: _cleared, ...rest }) => rest);
    const said = (problem: LoadProblem) => setProblems((current) => ({ ...current, [key]: problem }));
    startTransition(async () => {
      try {
        const answer = await run();
        if (answer.ok) keep(answer.page);
        else if (answer.error === 'gone') said({ own: 'gone' });
        // Anything but `gone` is a shared portal failure (too_many, uncertain, generic).
        else said({ failure: { error: answer.error, reference: answer.reference } as ShownPortalFailure });
      } catch {
        said({ own: key === SECTIONS ? 'loadSectionsFailed' : 'loadFailed' });
      } finally {
        inFlight.current.delete(key);
      }
    });
  }

  function moreSections() {
    ask(SECTIONS, () => loadContractSections(token, sections.length), (page) => {
      setSections((shown) => [...shown, ...page.sections]);
      setLines((shown) => ({ ...shown, ...Object.fromEntries(page.sections.map((section) => [section.id, []])) }));
    });
  }

  function moreLines(section: PublicContractSection) {
    const shown = lines[section.id] ?? [];
    ask(section.id, () => loadContractSectionLines(token, section.id, shown.length), (page) =>
      setLines((current) => ({ ...current, [section.id]: [...(current[section.id] ?? []), ...page.lines] })),
    );
  }

  function problemOf(key: string) {
    const problem = problems[key];
    if (!problem) return null;
    if ('failure' in problem) return <PortalFailureAlert failure={problem.failure} />;
    return (
      <p role="alert" className="text-body text-destructive">
        {t(problem.own)}
      </p>
    );
  }

  function section(summary: PublicContractSection) {
    const shown = lines[summary.id] ?? [];
    const remaining = summary.line_count - shown.length;
    const busy = pending && asking === summary.id;
    return (
      <Card key={summary.id}>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <h2 className="text-body font-semibold">{text(summary.title_ar, summary.title_en)}</h2>
            <span className="font-mono tabular-nums text-body" dir="ltr">{formatMoney(summary.section_subtotal, locale)}</span>
          </div>
          {shown.length > 0 && (
            <table className="w-full text-body">
              <tbody>
                {shown.map((line) => (
                  <tr key={line.id} className="border-b last:border-0">
                    <td className="px-4 py-2">
                      {line.item_code && <span className="me-2 text-muted-foreground" dir="ltr">{line.item_code}</span>}
                      {text(line.description_ar, line.description_en)}
                      {line.provisional && <span className="ms-2 text-caption text-muted-foreground">{t('provisional')}</span>}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground" dir="ltr">
                      {formatQuantity(line.qty, locale)} {line.unit}
                    </td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">{formatMoney(line.unit_price, locale)}</td>
                    <td className="px-4 py-2 text-end font-mono tabular-nums" dir="ltr">{formatMoney(line.line_total, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {remaining > 0 && (
            <div className="space-y-2 border-t px-4 py-3 text-center">
              <Button variant="secondary" size="sm" onClick={() => moreLines(summary)} disabled={busy}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {shown.length === 0 ? t('show', { count: remaining }) : t('showMore', { count: remaining })}
              </Button>
              {problemOf(summary.id)}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const listBusy = pending && asking === SECTIONS;
  return (
    <>
      {sections.map(section)}
      {sections.length < sectionCount && (
        <div className="space-y-2 text-center">
          <Button variant="secondary" size="sm" onClick={moreSections} disabled={listBusy}>
            {listBusy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('moreSections', { count: sectionCount - sections.length })}
          </Button>
          {problemOf(SECTIONS)}
        </div>
      )}
    </>
  );
}
