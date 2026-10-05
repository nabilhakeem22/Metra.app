'use client';

import { Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** The BOQ-mode primary action. Nothing to send means nothing to press. */
export function SendAsBoqButton({
  onSend,
  pending,
  disabled,
  lineCount,
}: {
  onSend: () => void;
  /** THIS send is in flight. */
  pending: boolean;
  /** Anything in the builder is in flight. */
  disabled: boolean;
  lineCount: number;
}) {
  const t = useTranslations('proposals.boqMode');
  return (
    <Button onClick={onSend} disabled={disabled || lineCount === 0}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Send className="size-4" aria-hidden />
      )}
      {t('send')}
    </Button>
  );
}
