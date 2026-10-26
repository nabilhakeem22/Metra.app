'use client';

import { Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PortalFailureAlert } from '@/components/share/portal-failure-alert';
import type { PublicContractLine, PublicContractSection, PublicSectionLinesPage, PublicSectionsPage } from '@/lib/contracts/public-types';
import { formatMoney } from '@/lib/format/money';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ShownPortalFailure } from '@/lib/share/portal-failure';
import { ContractLineRow } from './line-row';

/** One "show more" answer as the list reads it: the page, `gone`, or a shared portal failure. */
type PageAnswer<P> = { ok: true; page: P } | { ok: false; error: string; reference?: string };

/** What a "show more" left on screen: a shared portal failure, or the list's own sentence. */
type LoadProblem = { failure: ShownPortalFailure } | { own: OwnSentence };

/** The list's own sentences (portal.contract.lines). */
type OwnSentence = 'gone' | 'loadFailed' | 'sectionsGone' | 'loadSectionsFailed';

/** The key of the list's own ask; a section's lines are asked under the section's id. */
const SECTIONS = 'sections';

/** The list's own sentences for an ask under `key`: what it says when the read is gone, or failed on the way. */
function ownSentencesOf(key: string): { gone: OwnSentence; failed: OwnSentence } {
  return key === SECTIONS ? { gone: 'sectionsGone', failed: 'loadSectionsFailed' } : { gone: 'gone', failed: 'loadFailed' };
}

/**
 * A client's contract sections, as ONE list (A3 reliability R1), on /c and in
 * the client home: the first 50 sections open with the contract, holding its
 * first 50 lines between them; "show more sections" adds the next 50,
 * collapsed; each section shows its subtotal, the lines shown so far and "show
 * lines" for the rest, 100 at a time. The page decides where those reads go
 * (`loadSections`, `loadSectionLines`: its own link's server actions, each
 * spending that link's read budget). Every section renders inside this one
 * component, so the page follows the sections shown, never the contract's
 * total. A failed ask keeps what is shown and says why, in فصحى, under the
 * button that made it. `flat` draws the sections without glass, for a page
 * that nests them inside a panel of its own.
 */
export function ContractSectionList({
  sections: opening,
  sectionCount,
  loadSections,
  loadSectionLines,
  flat = false,
}: {
  sections: PublicContractSection[];
  sectionCount: number;
  loadSections: (offset: number) => Promise<PageAnswer<PublicSectionsPage>>;
  loadSectionLines: (sectionId: string, offset: number) => Promise<PageAnswer<PublicSectionLinesPage>>;
  flat?: boolean;
}) {
  const t = useTranslations('portal.contract.lines');
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
  function ask<P>(key: string, run: () => Promise<PageAnswer<P>>, keep: (page: P) => void) {
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    setAsking(key);
    setProblems(({ [key]: _cleared, ...rest }) => rest);
    const said = (problem: LoadProblem) => setProblems((current) => ({ ...current, [key]: problem }));
    const sentences = ownSentencesOf(key);
    startTransition(async () => {
      try {
        const answer = await run();
        if (answer.ok) keep(answer.page);
        else if (answer.error === 'gone') said({ own: sentences.gone });
        // Anything but `gone` is a shared portal failure (too_many, uncertain, generic).
        else said({ failure: { error: answer.error, reference: answer.reference } as ShownPortalFailure });
      } catch {
        said({ own: sentences.failed });
      } finally {
        inFlight.current.delete(key);
      }
    });
  }

  function moreSections() {
    ask(SECTIONS, () => loadSections(sections.length), (page) => {
      setSections((shown) => [...shown, ...page.sections]);
      setLines((shown) => ({ ...shown, ...Object.fromEntries(page.sections.map((section) => [section.id, []])) }));
    });
  }

  function moreLines(section: PublicContractSection) {
    const shown = lines[section.id] ?? [];
    ask(section.id, () => loadSectionLines(section.id, shown.length), (page) =>
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
      <Card key={summary.id} flat={flat}>
        <CardContent className="p-0">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
            <h2 className="text-body font-semibold [overflow-wrap:anywhere]">{text(summary.title_ar, summary.title_en)}</h2>
            <span className="whitespace-nowrap font-mono tabular-nums text-body" dir="ltr">{formatMoney(summary.section_subtotal, locale)}</span>
          </div>
          {shown.length > 0 && (
            <table className="block w-full text-body [@container(min-width:36rem)]:table">
              <tbody className="block [@container(min-width:36rem)]:table-row-group">
                {shown.map((line) => (
                  <ContractLineRow key={line.id} line={line} />
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
    // The width the line rows measure (./line-row.tsx).
    <div className="space-y-4 [container-type:inline-size]">
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
    </div>
  );
}
