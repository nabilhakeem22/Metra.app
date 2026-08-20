'use client';

import { Loader2, Send, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { PreviewModal } from './preview-modal';

export function BuilderToolbar({
  proposalId,
  seeMargin,
  canSend,
  pending,
  onDelete,
  onSave,
  onSend,
}: {
  proposalId: string;
  seeMargin: boolean;
  canSend: boolean;
  pending: boolean;
  onDelete: () => void;
  onSave: () => void;
  onSend: () => void;
}) {
  const t = useTranslations('proposals');

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button variant="ghost" onClick={onDelete} disabled={pending}>
        <Trash2 className="size-4" aria-hidden />
        {t('builder.delete')}
      </Button>
      <Button variant="outline" onClick={onSave} disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t('builder.save')}
      </Button>
      <PreviewModal
        proposalId={proposalId}
        canSeeInternal={seeMargin}
        canSend={canSend}
        isDraft
      />
      {canSend && (
        <Button onClick={onSend} disabled={pending}>
          <Send className="size-4" aria-hidden />
          {t('builder.send')}
        </Button>
      )}
    </div>
  );
}
