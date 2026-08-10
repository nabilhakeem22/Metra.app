import { organizations } from '@metra/db';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { SettingsClient } from './settings-client';

export default async function SettingsPage() {
  const ctx = await requireOrg();
  const t = await getTranslations('settings');

  const [org] = await withOrgContext(ctx, (tx) =>
    tx.select().from(organizations).limit(1),
  );

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <SettingsClient
        canManage={can(ctx.role, 'users_settings', 'update')}
        initial={{
          nameEn: org?.nameEn ?? '',
          nameAr: org?.nameAr ?? '',
          city: org?.city ?? '',
          taxRegistrationNumber: org?.taxRegistrationNumber ?? '',
          hideMarginFromPm: org?.hideMarginFromPm ?? false,
          restrictFirmDashboard: org?.restrictFirmDashboard ?? false,
        }}
      />
    </div>
  );
}
