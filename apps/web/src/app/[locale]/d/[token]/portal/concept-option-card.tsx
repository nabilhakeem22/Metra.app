'use client';

import { Eye } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { bidiIsolate } from '@/lib/format/bidi';

/**
 * One released concept option in the picker: its letter, "View" (the file in a
 * new tab, through the gated document route) and "Choose this option".
 */
export function ConceptOptionCard({
  token,
  option,
  pending,
  onChoose,
}: {
  token: string;
  option: PublicDelivery['conceptOptions'][number];
  pending: boolean;
  onChoose: () => void;
}) {
  const t = useTranslations('delivery.conceptPicker');
  const locale = useLocale();
  const titleId = `concept-option-${option.id}`;
  return (
    <li
      data-concept-option={option.letter}
      className="flex flex-wrap items-center gap-2 rounded-item border p-3"
    >
      <span id={titleId} className="text-body font-semibold">
        {t('option', { letter: bidiIsolate(option.letter) })}
      </span>
      <a
        href={`/${locale}/d/${encodeURIComponent(token)}/documents/${option.id}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-describedby={titleId}
        className="ms-auto inline-flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-caption font-semibold hover:bg-muted coarse:min-h-11"
      >
        <Eye className="size-3.5" aria-hidden />
        {t('view')}
      </a>
      <Button variant="default" size="sm" disabled={pending} aria-describedby={titleId} onClick={onChoose}>
        {t('choose')}
      </Button>
    </li>
  );
}
