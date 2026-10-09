'use client';

import { useTranslations } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';

/**
 * The note under an actionable hero. Optional for an approval; a request for
 * changes needs one, so while it is blank the hint says what to write (the
 * Request changes button points at it with `aria-describedby`). No text-size
 * class: the field keeps the 16 px touch size that stops iOS zooming in.
 */
export function ChangesNote({
  note,
  onChange,
  hintId,
  showHint,
}: {
  note: string;
  onChange: (note: string) => void;
  hintId: string;
  showHint: boolean;
}) {
  const tActions = useTranslations('delivery.actions');
  return (
    <div className="space-y-1.5">
      <Textarea
        value={note}
        onChange={(event) => onChange(event.target.value)}
        maxLength={2000}
        rows={2}
        dir="auto"
        aria-label={tActions('notePlaceholder')}
        placeholder={tActions('notePlaceholder')}
      />
      {showHint && (
        <p id={hintId} className="text-caption text-muted-foreground">
          {tActions('changesNeedNote')}
        </p>
      )}
    </div>
  );
}
