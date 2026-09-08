'use client';

import { Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { issueBoq } from '@/lib/boqs/actions';

/**
 * Issue the BOQ: freeze it, render its PDF, and hand that PDF to the engagement
 * as its `boq` artifact.
 *
 * Behind a confirm because it is not reversible — an issued BOQ is frozen, and
 * changing it afterwards means a new version rather than an edit. The dialog says
 * that, rather than asking "are you sure".
 */
export function BoqIssue({ boqId, disabled }: { boqId: string; disabled: boolean }) {
  const t = useTranslations('projects.profile.boq');
  const [pending, start] = useTransition();
  const { confirm, dialog } = useConfirm();

  // The confirm is awaited OUTSIDE the transition, and only the server action is
  // wrapped. Asking inside one deadlocks: React holds the current UI while a
  // transition is pending, so the dialog never paints — and the transition cannot
  // finish because it is waiting on that dialog. The button just spins forever.
  // Waiting for a person is not a transition; the work that follows is.
  async function onClick(): Promise<void> {
    const ok = await confirm({
      title: t('issueConfirmTitle'),
      description: t('issueConfirmBody'),
      confirmLabel: t('issueConfirm'),
      cancelLabel: t('cancel'),
    });
    if (!ok) return;

    start(async () => {
      try {
        const res = await issueBoq(boqId);
        if (res.ok) {
          toast({ title: t('issued') });
          return;
        }
        toast({
          title:
            res.error === 'engagement_not_found'
              ? t('issueNoEngagement')
              : t('issueFailed'),
          variant: 'destructive',
        });
      } catch {
        toast({ title: t('issueFailed'), variant: 'destructive' });
      }
    });
  }

  return (
    <>
      <Button disabled={disabled || pending} onClick={() => { void onClick(); }}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Send className="size-4" aria-hidden />
        )}
        {t('issue')}
      </Button>
      {dialog}
    </>
  );
}
