import { organizations } from '@merta/db';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { requireOrg } from '@/lib/auth/require-org';
import { signOut } from '@/lib/auth/actions';
import { withOrgContext } from '@/lib/db/context';
import { pickLocale } from '@/lib/i18n/pick-locale';

export default async function DashboardPage() {
  const ctx = await requireOrg();
  const locale = await getLocale();
  const t = await getTranslations('onboarding');

  const tc = await getTranslations('common');
  const [org] = await withOrgContext(ctx, (tx) =>
    tx.select().from(organizations).limit(1),
  );

  const name = pickLocale(org, 'name', locale);

  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 py-16 text-center">
      <h1 className="text-3xl font-bold">
        {t('welcome', { name: name.value })}
        {name.isFallback && (
          <span className="ms-2 align-middle text-xs text-muted-foreground">
            ({tc('untranslated')})
          </span>
        )}
      </h1>
      <p className="text-muted-foreground">
        role: <code className="font-mono">{ctx.role}</code>
      </p>
      <form action={signOut}>
        <Button variant="outline" type="submit">
          Sign out
        </Button>
      </form>
    </main>
  );
}
