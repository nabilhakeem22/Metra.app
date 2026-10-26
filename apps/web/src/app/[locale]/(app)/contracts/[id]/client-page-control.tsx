'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { openClientHome } from '@/lib/client-home/actions';
import type { ClientHomeLinkReason } from '@/lib/client-home/types';

type Shown = { link: string } | { reason: ClientHomeLinkReason } | { error: string } | null;

/**
 * The contract page's "Client page" control (an issued or signed BOQ
 * contract, for a role that issues contracts): one tap opens the client's home
 * for this contract, creating it when no delivery stands behind the BOQ, and
 * shows its Execution tab link to copy and send. A role that may not share
 * links, or a link that cannot be shown, is told why instead. The await is
 * wrapped, so a rejected action never strands the spinner. Egyptian copy.
 */
export function ClientPageControl({ contractId }: { contractId: string }) {
  const t = useTranslations('contracts.clientPage');
  const te = useTranslations('errors');
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useState<Shown>(null);

  function open() {
    setShown(null);
    startTransition(async () => {
      try {
        const res = await openClientHome(contractId);
        if (!res.ok) setShown({ error: describeFailure(res, te) });
        else setShown(res.link ? { link: res.link } : { reason: res.linkReason ?? 'not_allowed' });
      } catch (rejection) {
        setShown({ error: describeRejection(rejection, te) });
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4 text-body">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t('title')}</p>
            <p className="text-caption text-muted-foreground">{t('body')}</p>
          </div>
          <Button variant="secondary" size="sm" disabled={pending} onClick={open}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {t('open')}
          </Button>
        </div>
        {shown && 'link' in shown && (
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate" dir="ltr">
              {shown.link}
            </code>
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(shown.link)}>
              {t('copy')}
            </Button>
          </div>
        )}
        {shown && 'reason' in shown && (
          <p className="text-caption text-muted-foreground" role="status">
            {t(`reason.${shown.reason}`)}
          </p>
        )}
        {shown && 'error' in shown && (
          <p className="text-caption text-destructive" role="alert">
            {shown.error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
