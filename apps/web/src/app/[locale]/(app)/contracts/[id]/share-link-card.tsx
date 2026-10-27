'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { describeFailure } from '@/lib/actions/error-message';
import type { ClientHomeAnswer } from '@/lib/client-home/types';
import { ClientHomeLinkResult } from './client-home-link-result';
import { clientHomeShownOf } from './client-home-shown';
import type { SharedLink } from './shared-link';

/**
 * What the studio sends the client after an act, shown once: a document's own
 * link with a copy button, or, for an execution contract just issued, its
 * client home (H6.4).
 */
export function ShareLinkCard({ shared }: { shared: SharedLink }) {
  return shared.kind === 'home' ? <HomeLinkCard answer={shared.answer} /> : <DocumentLinkCard link={shared.link} />;
}

function DocumentLinkCard({ link }: { link: string }) {
  const t = useTranslations('contracts');
  return (
    <Card>
      <CardContent className="flex items-center gap-2 py-3 text-body">
        <span className="text-muted-foreground">{t('shareLink')}:</span>
        <code className="flex-1 truncate" dir="ltr">
          {link}
        </code>
        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(link)}>
          {t('copyLink')}
        </Button>
      </CardContent>
    </Card>
  );
}

/** The issued contract's client home: the client signs there with a code; a failure says to try the Client page control. */
function HomeLinkCard({ answer }: { answer: ClientHomeAnswer }) {
  const t = useTranslations('contracts.clientPage.issued');
  const te = useTranslations('errors');
  return (
    <Card>
      <CardContent className="space-y-3 py-4 text-body">
        <div>
          <p className="font-semibold">{t('title')}</p>
          <p className="text-caption text-muted-foreground">{t('body')}</p>
        </div>
        <ClientHomeLinkResult shown={clientHomeShownOf(answer, (failure) => describeFailure(failure, te))} />
        {!answer.ok && <p className="text-caption text-muted-foreground">{t('retry')}</p>}
      </CardContent>
    </Card>
  );
}
