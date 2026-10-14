'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { describeFailure } from '@/lib/actions/error-message';
import { formatTime } from '@/lib/format/date';
import type { DraftAutosaveApi } from './use-draft-autosave';

/**
 * Where the builder's autosave stands, said in the toolbar: "Saved 14:02",
 * "Saving", "Unsaved changes", or "Not saved" with why and a Retry. There is no
 * Save button: the draft saves itself.
 */
export function BuilderSaveStatus({
  autosave: { saveState, incomplete, lastSavedAt, failure, retry },
}: {
  autosave: Pick<DraftAutosaveApi, 'saveState' | 'incomplete' | 'lastSavedAt' | 'failure' | 'retry'>;
}) {
  const t = useTranslations('proposals.builder.autosave');
  const te = useTranslations('errors');
  const locale = useLocale();

  if (saveState === 'failed') {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span role="alert" className="text-small font-semibold text-destructive">
          {t('failed', { reason: describeFailure(failure ?? {}, te) })}
        </span>
        <Button type="button" variant="secondary" size="sm" onClick={retry}>
          {t('retry')}
        </Button>
      </span>
    );
  }

  const label =
    saveState === 'saving'
      ? t('saving')
      : saveState === 'dirty'
        ? t(incomplete ? 'incomplete' : 'dirty')
        : lastSavedAt
          ? t('savedAt', { time: formatTime(lastSavedAt, locale) })
          : t('saved');
  return (
    <span role="status" className="text-small text-[color:var(--text-muted)]">
      {label}
    </span>
  );
}
