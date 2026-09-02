import { organizations } from '@metra/db';
import { getTranslations } from 'next-intl/server';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Link } from '@/i18n/routing';
import { requireOrg } from '@/lib/auth/require-org';
import { getAutomationSettings } from '@/lib/automation/settings-queries';
import { withOrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { AutomationSettingsClient } from './automation-settings-client';
import { listDocumentCategories } from '@/lib/document-categories/queries';
import { DocumentCategoriesCard } from './document-categories-card';
import { SettingsClient } from './settings-client';

export default async function SettingsPage() {
  const ctx = await requireOrg();
  const t = await getTranslations('settings');

  const [org] = await withOrgContext(ctx, (tx) =>
    tx.select().from(organizations).limit(1),
  );
  const automation = await getAutomationSettings(ctx);
  const canManage = can(ctx.role, 'users_settings', 'update');
  // The document-category core gates on projects/update, matching the other
  // firm-vocabulary settings (project types, stage templates). Show the card to
  // exactly the roles that can actually use it — a control nobody can operate is
  // worse than an absent one.
  const canManageVocabulary = can(ctx.role, 'projects', 'update');

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <SettingsClient
        canManage={canManage}
        initial={{
          nameEn: org?.nameEn ?? '',
          nameAr: org?.nameAr ?? '',
          city: org?.city ?? '',
          taxRegistrationNumber: org?.taxRegistrationNumber ?? '',
          hideMarginFromPm: org?.hideMarginFromPm ?? false,
          restrictFirmDashboard: org?.restrictFirmDashboard ?? false,
        }}
      />
      {/* The firm's document filing vocabulary — gated on the same capability as
          the other firm-vocabulary settings (project types, stage templates). */}
      {canManageVocabulary && (
        <DocumentCategoriesCard
          categories={(await listDocumentCategories(ctx)).map((c) => ({
            id: c.id,
            nameEn: c.nameEn,
            nameAr: c.nameAr,
            active: c.active,
          }))}
        />
      )}

      <AutomationSettingsClient
        canManage={canManage}
        initial={{
          expireEnabled: automation?.expireEnabled ?? true,
          expireNudgeEnabled: automation?.expireNudgeEnabled ?? false,
          expireNudgeLeadDays: automation?.expireNudgeLeadDays ?? 3,
          followupEnabled: automation?.followupEnabled ?? true,
          followupThresholdDays: automation?.followupThresholdDays ?? 5,
          digestEnabled: automation?.digestEnabled ?? true,
          digestCadence: automation?.digestCadence ?? 'weekly',
          stageRemindersEnabled: automation?.stageRemindersEnabled ?? true,
        }}
      />
      {canManage && (
        <Link href="/settings/api-keys" className="block">
          <Card className="transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardTitle>{t('apiKeysCardTitle')}</CardTitle>
              <CardDescription>{t('apiKeysCardDesc')}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      )}
    </div>
  );
}
