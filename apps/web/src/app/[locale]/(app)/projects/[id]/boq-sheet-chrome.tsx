'use client';

import { Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
import type { BoqDetail } from '@/lib/boqs/queries';
import { BOQ_ADD_BUTTON_CLASS } from './boq-sheet-section';

// The frame around the sheet: what the document IS at the top, and what the
// document is DOING at the bottom.

const ISSUED_PILL: CSSProperties = {
  background: 'var(--success-tint)',
  color: 'var(--success)',
};

const DRAFT_PILL: CSSProperties = {
  background: 'var(--warn-tint)',
  color: 'var(--warn)',
};

export function BoqSheetHeader({
  boq,
  visibleCount,
  query,
  onQueryChange,
  actions,
}: {
  boq: BoqDetail;
  /** The lines ACTUALLY on screen — the count follows the search. */
  visibleCount: number;
  query: string;
  onQueryChange: (query: string) => void;
  /** Issue / download controls — owned by the tab, rendered in this header. */
  actions?: ReactNode;
}) {
  const t = useTranslations('projects.profile.boq');
  const issued = boq.status === 'issued';
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--rule)] p-4">
      <div>
        <p className="flex items-center gap-2 font-bold text-[color:var(--text)]">
          <span dir="auto">{boq.title}</span>
          <span
            className="rounded-pill px-2 py-1 text-[11px] font-semibold uppercase"
            style={issued ? ISSUED_PILL : DRAFT_PILL}
          >
            {issued ? t('statusIssued') : t('statusDraft')}
          </span>
        </p>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">
          {t('documentLabel', { number: String(boq.number) })} ·{' '}
          {t('lineCount', { count: visibleCount })}
        </p>
      </div>

      <div className="ms-auto flex flex-wrap items-center gap-2">
        <label className="flex min-w-[180px] items-center gap-2 rounded-pill border border-[color:var(--field-border)] bg-[color:var(--field-bg)] px-3 py-2">
          <Search className="size-4 shrink-0 text-[color:var(--text-faint)]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t('find')}
            aria-label={t('find')}
            className="w-full border-0 bg-transparent p-0 text-sm text-[color:var(--text)] outline-none"
          />
        </label>
        {actions}
      </div>
    </div>
  );
}

/**
 * The autosave light. A sheet that writes on blur MUST say whether it has
 * written: autosave with no unsaved marker is a lie the studio only discovers
 * after closing the tab.
 */
export function BoqSheetFooter({
  savingCount,
  pending,
  onAddSection,
}: {
  savingCount: number;
  pending: boolean;
  onAddSection: () => void;
}) {
  const t = useTranslations('projects.profile.boq');
  const saving = savingCount > 0;
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[color:var(--rule)] p-3 text-[13px]">
      <button
        type="button"
        onClick={onAddSection}
        disabled={pending}
        className={BOQ_ADD_BUTTON_CLASS}
      >
        <Plus className="size-3.5" aria-hidden />
        {t('addSection')}
      </button>
      <span
        className="inline-flex items-center gap-2 font-semibold"
        style={{ color: saving ? 'var(--text-muted)' : 'var(--success)' }}
      >
        <span
          className="size-2 rounded-full"
          style={{ background: saving ? 'var(--text-faint)' : 'var(--success)' }}
        />
        {saving ? t('saving') : t('allSaved')}
      </span>
      <span className="ms-auto text-xs text-[color:var(--text-faint)]">
        {t('keyboardHint')}
      </span>
    </div>
  );
}
