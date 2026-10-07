'use client';

import { useTranslations } from 'next-intl';
import type { ConceptLetter } from '@/lib/engagements/concept-letter';
import { bidiIsolate } from '@/lib/format/bidi';

const CHIP = 'inline-flex items-center rounded-pill border px-2 py-0.5 text-caption font-semibold';

/**
 * A concept option's chips in the artifact list: its letter as the CLIENT sees
 * it now ("Option B", absent while the option is not released), and "Client
 * choice" on the option the client chose, which stays after the studio hides
 * it. Renders nothing when neither applies.
 */
export function ConceptOptionChip({ letter, chosen }: { letter: ConceptLetter | null; chosen: boolean }) {
  const t = useTranslations('engagements.conceptOption');
  if (letter === null && !chosen) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {letter && (
        <span data-option-letter={letter} className={CHIP}>
          {t('letter', { letter: bidiIsolate(letter) })}
        </span>
      )}
      {chosen && (
        <span
          data-client-choice-chip=""
          className={`${CHIP} border-[color:var(--brand-tint-border)] bg-brand-tint text-brand-ink`}
        >
          {t('clientChoice')}
        </span>
      )}
    </span>
  );
}
