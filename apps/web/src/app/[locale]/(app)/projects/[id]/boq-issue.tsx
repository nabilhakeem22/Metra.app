'use client';

import { Loader2, Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { issueBoq } from '@/lib/boqs/actions';

/** Refusals whose own catalog sentence tells the studio what to do next. */
const SPEAKS_FOR_ITSELF: ReadonlySet<ActionCode | undefined> = new Set<ActionCode | undefined>([
  'boq_send_conflict',
  'renderer_busy',
]);

/**
 * Issue the BOQ: freeze it, render its PDF, and hand that PDF to the engagement
 * as its `boq` artifact.
 *
 * Behind a confirm because it is not reversible — an issued BOQ is frozen, and
 * changing it afterwards means a new version rather than an edit. The dialog says
 * that, rather than asking "are you sure".
 */
export function BoqIssue({
  boqId,
  disabled,
  clientCanOpen,
}: {
  boqId: string;
  disabled: boolean;
  /** Whether the client can open it the moment it is published (the portal's
   *  BOQ rule), so the confirm states what will actually happen. */
  clientCanOpen: boolean;
}) {
  const t = useTranslations('projects.profile.boq');
  const te = useTranslations('errors');
  const [pending, start] = useTransition();

  const failureMessage = (code: ActionCode | undefined): string => {
    if (code === 'engagement_not_found') return t('issueNoEngagement');
    return SPEAKS_FOR_ITSELF.has(code) ? resolveActionError(code, te) : t('issueFailed');
  };
  const { confirm, dialog } = useConfirm();

  // The confirm is awaited OUTSIDE the transition, and only the server action is
  // wrapped. Asking inside one deadlocks: React holds the current UI while a
  // transition is pending, so the dialog never paints — and the transition cannot
  // finish because it is waiting on that dialog. The button just spins forever.
  // Waiting for a person is not a transition; the work that follows is.
  async function onClick(): Promise<void> {
    const ok = await confirm({
      title: t('issueConfirmTitle'),
      description: clientCanOpen ? t('issueConfirmBodyOpen') : t('issueConfirmBody'),
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
        toast({ title: failureMessage(res.error), variant: 'destructive' });
      } catch {
        toast({ title: t('issueFailed'), variant: 'destructive' });
      }
    });
  }

  return (
    <>
      <Button variant="default" disabled={disabled || pending} onClick={() => { void onClick(); }}>
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
