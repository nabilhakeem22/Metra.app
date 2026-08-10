import { getTranslations } from 'next-intl/server';
import { AuthShell } from '@/components/auth/auth-shell';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { getSessionUser } from '@/lib/auth/session';
import { AcceptInvite } from './accept-client';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string; locale: string }>;
}) {
  const { token } = await params;
  const t = await getTranslations('accept');
  const user = await getSessionUser();

  if (!user) {
    // Route through login first; the invite link can be reopened after sign-in.
    return (
      <AuthShell>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold tracking-tight">
            {t('signInTitle')}
          </h1>
          <p className="text-sm text-muted-foreground">{t('signInBody')}</p>
          <Button asChild className="w-full">
            <Link href="/login">{t('signInButton')}</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AcceptInvite token={token} />
    </AuthShell>
  );
}
