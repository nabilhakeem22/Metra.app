'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { openClientHome } from '@/lib/client-home/actions';
import { ClientHomeLinkResult } from './client-home-link-result';
import { clientHomeShownOf, type ClientHomeShown } from './client-home-shown';

/**
 * The contract page's "Client page" control (an issued or signed BOQ
 * contract, for a role that issues contracts): one tap opens the client's home
 * for this contract, creating it when no delivery stands behind the BOQ, and
 * shows its Execution tab link to copy and send. A link that cannot be shown
 * is told why instead. The await is
 * wrapped, so a rejected action never strands the spinner. Egyptian copy.
 */
export function ClientPageControl({ contractId }: { contractId: string }) {
  const t = useTranslations('contracts.clientPage');
  const te = useTranslations('errors');
  const [pending, startTransition] = useTransition();
  const [shown, setShown] = useState<ClientHomeShown | null>(null);

  function open() {
    setShown(null);
    startTransition(async () => {
      try {
        setShown(clientHomeShownOf(await openClientHome(contractId), (failure) => describeFailure(failure, te)));
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
        {shown && <ClientHomeLinkResult shown={shown} />}
      </CardContent>
    </Card>
  );
}
