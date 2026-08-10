'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Link, useRouter } from '@/i18n/routing';
import { acceptInvite } from '@/lib/team/actions';

export function AcceptInvite({ token }: { token: string }) {
  const t = useTranslations('accept');
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [declined, setDeclined] = useState(false);

  function accept() {
    startTransition(async () => {
      const res = await acceptInvite(token);
      if (res.ok) {
        router.push('/dashboard');
      } else {
        // Single generic decline for every failure path — no oracle.
        setDeclined(true);
      }
    });
  }

  if (declined) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">
          {t('declinedTitle')}
        </h1>
        <p className="text-sm text-muted-foreground">{t('declinedBody')}</p>
        <Button asChild variant="outline">
          <Link href="/dashboard">{t('backToDashboard')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('body')}</p>
      <Button className="w-full" onClick={accept} disabled={isPending}>
        {isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {t('acceptButton')}
      </Button>
    </div>
  );
}
