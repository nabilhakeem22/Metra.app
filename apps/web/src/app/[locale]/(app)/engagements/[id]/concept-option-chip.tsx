'use client';

import { useTranslations } from 'next-intl';
import type { ConceptLetter } from '@/lib/engagements/concept-letter';
import { bidiIsolate } from '@/lib/format/bidi';

const CHIP = 'inline-flex items-center rounded-pill border px-2 py-0.5 text-caption font-semibold';

/**
 * A concept option's chip in the artifact list. The option the client CHOSE
 * shows only the letter SAVED with that choice ("Client chose option B"), the
 * same letter as the card, the timeline and the bell, even after the studio
 * hid or released options and its current letter moved: the studio never sees
 * two letters for the client's pick. Every other option shows its letter as the
 * client sees it now, or nothing while it is not released.
 */
export function ConceptOptionChip({
  letter,
  chosenLetter,
}: {
  /** The option's current letter (null while hidden, file-less or past D). */
  letter: ConceptLetter | null;
  /** The letter saved with the client's choice, when this is the chosen option. */
  chosenLetter: ConceptLetter | null;
}) {
  const t = useTranslations('engagements.conceptOption');
  if (chosenLetter) {
    return (
      <span
        data-client-choice-chip={chosenLetter}
        className={`${CHIP} border-[color:var(--brand-tint-border)] bg-brand-tint text-brand-ink`}
      >
        {t('clientChoice', { letter: bidiIsolate(chosenLetter) })}
      </span>
    );
  }
  if (letter === null) return null;
  return (
    <span data-option-letter={letter} className={CHIP}>
      {t('letter', { letter: bidiIsolate(letter) })}
    </span>
  );
}
