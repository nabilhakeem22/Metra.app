'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Eye, FileDown, Loader2, Send, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  getProposalPreviewHtml,
  sendProposal,
} from '@/lib/proposals/actions';
import { cn } from '@/lib/utils';

type Variant = 'client' | 'internal';

/**
 * In-app proposal preview. Renders the exact PDF HTML in a sandboxed iframe,
 * toggles Client/Internal (internal only when the caller may see margin), and
 * offers the matching PDF downloads plus Send (drafts only). The internal copy
 * is fetched through the margin-gated action, so a non-privileged caller can
 * never pull cost figures.
 */
export function PreviewModal({
  proposalId,
  canSeeInternal,
  canSend = false,
  isDraft = false,
  className,
}: {
  proposalId: string;
  canSeeInternal: boolean;
  canSend?: boolean;
  isDraft?: boolean;
  className?: string;
}) {
  const t = useTranslations('proposals.preview');
  const te = useTranslations('errors');
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState<Variant>('client');
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, startSend] = useTransition();

  const load = useCallback(
    async (v: Variant) => {
      setLoading(true);
      setHtml(null);
      try {
        const res = await getProposalPreviewHtml(proposalId, v);
        if (res.ok && res.html) {
          setHtml(res.html);
        } else {
          toast({
            title: resolveActionError(res.error as ActionCode, te),
            variant: 'destructive',
          });
        }
      } catch {
        // Never leave the spinner hanging if the action rejects.
        toast({
          title: resolveActionError('generic', te),
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    },
    [proposalId, te],
  );

  useEffect(() => {
    if (open) void load(variant);
  }, [open, variant, load]);

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

  const tab = (v: Variant, label: string) => (
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
        <Button variant="outline" size="sm" className={className}>
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

          <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-2">
            <a
              href={`/api/pdf/proposals/${proposalId}?variant=client`}
              target="_blank"
              rel="noreferrer"
            >
              <Button variant="outline" size="sm">
                <FileDown className="size-4" aria-hidden />
                {t('download')}
              </Button>
            </a>
            {canSeeInternal && (
              <a
                href={`/api/pdf/proposals/${proposalId}?variant=internal`}
                target="_blank"
                rel="noreferrer"
              >
                <Button variant="outline" size="sm">
                  <FileDown className="size-4" aria-hidden />
                  {t('downloadInternal')}
                </Button>
              </a>
            )}
            {canSend && isDraft && (
              <Button size="sm" onClick={onSend} disabled={sending}>
                {sending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                {t('send')}
              </Button>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
