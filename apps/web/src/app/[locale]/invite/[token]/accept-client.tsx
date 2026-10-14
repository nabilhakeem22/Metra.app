'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/routing';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { acceptInvite } from '@/lib/team/actions';

/** The answers that end this invitation for this person: each says its own way out. */
const UNUSABLE: ReadonlySet<ActionCode> = new Set(['invite_expired', 'invite_wrong_account', 'invite_not_found']);

type Outcome = { kind: 'already' } | { kind: 'unusable'; reason: string } | { kind: 'failed'; reason: string };

export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations('accept');
  const te = useTranslations('errors');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function accept() {
    startTransition(async () => {
      try {
        const result = await acceptInvite(token);
        if (result.ok && result.already) setOutcome({ kind: 'already' });
        else if (result.ok) router.push('/dashboard');
        else if (result.error && UNUSABLE.has(result.error)) setOutcome({ kind: 'unusable', reason: describeFailure(result, te) });
        // A failure on our side or the network: the invitation is still good, so Accept stays.
        else setOutcome({ kind: 'failed', reason: describeFailure(result, te) });
      } catch (rejection) {
        setOutcome({ kind: 'failed', reason: describeRejection(rejection, te) });
      }
    });
  }

  if (outcome?.kind === 'already') {
    return (
      <div className="space-y-3">
        <h1 className="text-heading font-bold">{t('alreadyTitle')}</h1>
        <p className="text-body text-muted-foreground">{t('alreadyBody')}</p>
        <Button variant="default" asChild>
          <Link href="/dashboard">{t('backToDashboard')}</Link>
        </Button>
      </div>
    );
  }

  if (outcome?.kind === 'unusable') {
    return (
      <div className="space-y-3">
        <h1 className="text-heading font-bold">{t('declinedTitle')}</h1>
        <p className="text-body text-muted-foreground">{outcome.reason}</p>
        <Button asChild variant="secondary">
          <Link href="/dashboard">{t('backToDashboard')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-heading font-bold">{t('title')}</h1>
      <p className="text-body text-muted-foreground">{t('body')}</p>
      {outcome?.kind === 'failed' && (
        <p className="text-body text-destructive" role="alert">
          {outcome.reason}
        </p>
      )}
      <Button variant="default" className="w-full" onClick={accept} disabled={isPending}>
        {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t('acceptButton')}
      </Button>
    </div>
  );
}
