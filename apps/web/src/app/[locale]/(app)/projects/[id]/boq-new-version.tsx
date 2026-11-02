'use client';

import { CopyPlus, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { startBoqVersion } from '@/lib/boqs/actions';

/**
 * Start a new version of an issued BOQ: a draft with the same lines, which the tab
 * then shows in its place. No confirm: nothing reaches the client until the draft
 * is issued, and that has its own. A refusal says its own cause.
 */
export function BoqNewVersion({ boqId }: { boqId: string }) {
  const t = useTranslations('projects.profile.boq');
  const te = useTranslations('errors');
  const [pending, start] = useTransition();

  function onClick(): void {
    start(async () => {
      try {
        const res = await startBoqVersion(boqId);
        if (!res.ok) toast({ title: describeFailure(res, te), variant: 'destructive' });
      } catch (rejection) {
        toast({ title: describeRejection(rejection, te), variant: 'destructive' });
      }
    });
  }

  return (
    <Button variant="secondary" disabled={pending} onClick={onClick}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CopyPlus className="size-4" aria-hidden />}
      {t('newVersion')}
    </Button>
  );
}
