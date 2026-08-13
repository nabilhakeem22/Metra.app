import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { can } from '@/lib/permissions/can';
import { getOrgMemberIdentities } from '@/lib/team/identities';
import { listPendingInvitations } from '@/lib/team/queries';
import { TeamClient } from './team-client';

export default async function TeamPage() {
  const ctx = await requireOrg();
  const t = await getTranslations('team');

  const members = await getOrgMemberIdentities(ctx);
  const pending = await listPendingInvitations(ctx);

  const now = Date.now();
  const pendingSerialized = pending.map((p) => ({
    id: p.id,
    email: p.email,
    role: p.role,
    expiresAt: p.expiresAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
    expired: p.expiresAt.getTime() <= now,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <TeamClient
        members={members}
        pending={pendingSerialized}
        canManage={can(ctx.role, 'users_settings', 'update')}
        isOwner={ctx.role === 'owner'}
        currentUserId={ctx.userId}
      />
    </div>
  );
}
