'use client';

import { FileDown, Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/**
 * The preview's footer: the PDF downloads (when this document HAS a quotation
 * PDF) and Send (a draft quote, for a role that may send). Renders nothing when
 * neither applies, so the BOQ-mode preview is the document and nothing else.
 */
export function PreviewFooter({
  proposalId,
  canSeeInternal,
  downloadable,
  showSend,
  sending,
  onSend,
}: {
  proposalId: string;
  canSeeInternal: boolean;
  downloadable: boolean;
  showSend: boolean;
  sending: boolean;
  onSend: () => void;
}) {
  const t = useTranslations('proposals.preview');
  if (!downloadable && !showSend) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-2">
      {downloadable && (
        <a href={`/api/pdf/proposals/${proposalId}?variant=client`} target="_blank" rel="noreferrer">
          <Button variant="secondary" size="sm">
            <FileDown className="size-4" aria-hidden />
            {t('download')}
          </Button>
        </a>
      )}
      {downloadable && canSeeInternal && (
        <a href={`/api/pdf/proposals/${proposalId}?variant=internal`} target="_blank" rel="noreferrer">
          <Button variant="secondary" size="sm">
            <FileDown className="size-4" aria-hidden />
            {t('downloadInternal')}
          </Button>
        </a>
      )}
      {showSend && (
        <Button variant="default" size="sm" onClick={onSend} disabled={sending}>
          {sending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Send className="size-4" aria-hidden />
          )}
          {t('send')}
        </Button>
      )}
    </div>
  );
}
