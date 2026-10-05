'use client';

import { Loader2, Send, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { PreviewModal } from './preview-modal';

/**
 * `mode: 'boq'` is the delivery's BOQ working copy: no Delete, no quote Send, no
 * PDF downloads in the preview (the BOQ PDF is produced when it is sent), and
 * the BOQ's own action arrives as `children`.
 */
export function BuilderToolbar({
  mode,
  proposalId,
  seeMargin,
  canSend,
  pending,
  busy,
  onDelete,
  onSave,
  onSend,
  children,
}: {
  mode: 'quote' | 'boq';
  proposalId: string;
  seeMargin: boolean;
  canSend: boolean;
  /** THIS toolbar's own save/send/delete is in flight (drives the spinner). */
  pending: boolean;
  /** Anything in the builder is in flight: every control here is disabled. */
  busy: boolean;
  onDelete: () => void;
  onSave: () => void;
  onSend: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations('proposals');
  const quote = mode === 'quote';

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {quote && (
        <Button variant="ghost" onClick={onDelete} disabled={busy}>
          <Trash2 className="size-4" aria-hidden />
          {t('builder.delete')}
        </Button>
      )}
      <Button variant="outline" onClick={onSave} disabled={busy}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t('builder.save')}
      </Button>
      <PreviewModal
        proposalId={proposalId}
        canSeeInternal={seeMargin}
        canSend={quote && canSend}
        downloadable={quote}
        disabled={busy}
        isDraft
      />
      {quote && canSend && (
        <Button onClick={onSend} disabled={busy}>
          <Send className="size-4" aria-hidden />
          {t('builder.send')}
        </Button>
      )}
      {children}
    </div>
  );
}
