import { sql } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
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

  const existing = (await withUserContext(user.id, (tx) =>
    tx.execute(
      sql`select org_id from public.app_current_user_memberships() limit 1`,
    ),
  )) as unknown as unknown[];
  if (existing.length > 0) {
    redirect('/dashboard');
  }

  const t = await getTranslations('onboarding');

  return (
    <AuthShell showValueProp>
      <form action={createOrg} className="space-y-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('hint')}</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="nameEn">{t('nameEnLabel')}</Label>
          <Input id="nameEn" name="nameEn" dir="ltr" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="nameAr">{t('nameArLabel')}</Label>
          <Input id="nameAr" name="nameAr" dir="rtl" />
        </div>

        <Button type="submit" className="w-full">
          {t('create')}
        </Button>
      </form>
    </AuthShell>
  );
}
