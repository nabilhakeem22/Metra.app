import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/ui/page-header';
import { listApiKeys } from '@/lib/api-keys/queries';
import { requireOrg } from '@/lib/auth/require-org';
import { can } from '@/lib/permissions/can';
import { ApiKeysClient } from './api-keys-client';

export default async function ApiKeysPage() {
  const ctx = await requireOrg();
  const t = await getTranslations('apiKeys');
  // Owner/admin only. A non-manager session sees a locked state and never the
  // key list; the mint/revoke cores also refuse (forbidden) as a second factor.
  const canManage = can(ctx.role, 'users_settings', 'update');
  const keys = canManage ? await listApiKeys(ctx) : [];

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      {canManage ? (
        <ApiKeysClient initialKeys={keys} />
      ) : (
        <p className="rounded-xl border bg-muted/40 p-3 text-sm text-muted-foreground">
          {t('forbidden')}
        </p>
      )}
    </div>
  );
}
