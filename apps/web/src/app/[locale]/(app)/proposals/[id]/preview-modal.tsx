'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Eye, Loader2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { sendProposal } from '@/lib/proposals/actions';
import { cn } from '@/lib/utils';
import { PreviewFooter } from './preview-footer';
import { usePreviewHtml, type PreviewVariant } from './use-preview-html';

/**
 * In-app proposal preview. Renders the exact PDF HTML in a sandboxed iframe
 * (./use-preview-html), toggles Client/Internal (internal only when the caller
 * may see margin), and offers the matching PDF downloads plus Send (drafts only)
 * in ./preview-footer. `downloadable={false}` is the BOQ working copy, which has
 * no quotation PDF.
 */
export function PreviewModal({
  proposalId,
  canSeeInternal,
  canSend = false,
  isDraft = false,
  downloadable = true,
  disabled = false,
  className,
}: {
  proposalId: string;
  canSeeInternal: boolean;
  canSend?: boolean;
  isDraft?: boolean;
  downloadable?: boolean;
  /** The builder is busy (a save or a send in flight): the preview cannot open. */
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('proposals.preview');
  const te = useTranslations('errors');
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState<PreviewVariant>('client');
  const [sending, startSend] = useTransition();
  const { html, loading } = usePreviewHtml(proposalId, open, variant);

  function onSend() {
    startSend(async () => {
      const res = await sendProposal(proposalId);
      if (res.ok) {
        toast({ title: t('send') });
        setOpen(false);
      } else {
        toast({
          title: resolveActionError(res.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  const tab = (v: PreviewVariant, label: string) => (
    <button
      type="button"
      onClick={() => setVariant(v)}
      className={cn(
        'border-b-2 px-3 py-1.5 text-sm transition-colors',
        variant === v
          ? 'border-primary font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button variant="outline" size="sm" className={className} disabled={disabled}>
          <Eye className="size-4" aria-hidden />
          {t('open')}
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        <DialogPrimitive.Content className="fixed inset-0 z-50 m-auto flex h-[90vh] w-[min(56rem,92vw)] flex-col border bg-card shadow-card outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none">
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <DialogPrimitive.Title className="text-sm font-semibold">
              {t('title')}
            </DialogPrimitive.Title>
            <div className="ms-4 flex items-center gap-1">
              {tab('client', t('client'))}
              {canSeeInternal && tab('internal', t('internal'))}
            </div>
            <DialogPrimitive.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('close')}
                className="ms-auto"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="relative flex-1 overflow-hidden bg-muted">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="me-2 size-4 animate-spin" aria-hidden />
                {t('loading')}
              </div>
            )}
            {html && (
              <iframe
                title={t('title')}
                srcDoc={html}
                sandbox=""
                className="size-full border-0 bg-white"
              />
            )}
          </div>

          <PreviewFooter
            proposalId={proposalId}
            canSeeInternal={canSeeInternal}
            downloadable={downloadable}
            showSend={canSend && isDraft}
            sending={sending}
            onSend={onSend}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
