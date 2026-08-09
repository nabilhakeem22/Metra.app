import { memberships } from '@merta/db';
import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createOrg } from '@/lib/auth/actions';
import { getSessionUser } from '@/lib/auth/session';
import { withUserContext } from '@/lib/db/context';

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  const existing = await withUserContext(user.id, (tx) =>
    tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(eq(memberships.userId, user.id))
      .limit(1),
  );
  if (existing.length > 0) {
    redirect('/dashboard');
  }

  const t = await getTranslations('onboarding');

  return (
    <main className="container flex min-h-screen items-center justify-center py-16">
      <form
        action={createOrg}
        className="w-full max-w-md space-y-5 rounded-lg border p-6 shadow-sm"
      >
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('hint')}</p>

        <div className="space-y-2">
          <Label htmlFor="nameEn">{t('nameEnLabel')}</Label>
          <Input id="nameEn" name="nameEn" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="nameAr">{t('nameArLabel')}</Label>
          <Input id="nameAr" name="nameAr" dir="rtl" />
        </div>

        <Button type="submit" className="w-full">
          {t('create')}
        </Button>
      </form>
    </main>
  );
}
