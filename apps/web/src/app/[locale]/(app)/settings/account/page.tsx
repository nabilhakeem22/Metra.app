import { getLocale, getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/ui/page-header';
import { getSessionUser } from '@/lib/auth/session';
import { AccountClient } from './account-client';

export default async function AccountPage() {
  const user = await getSessionUser();
  const t = await getTranslations('account');
  const locale = await getLocale();

  const meta = user?.user_metadata as { full_name?: string } | undefined;

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <AccountClient
        initialFullName={meta?.full_name ?? ''}
        email={user?.email ?? ''}
        currentLocale={locale === 'en' ? 'en' : 'ar-EG'}
      />
    </div>
  );
}
