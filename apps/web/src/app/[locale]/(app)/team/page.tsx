import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { can } from '@/lib/permissions/can';
import { getOrgMemberIdentities } from '@/lib/team/identities';
import { listPendingInvitations } from '@/lib/team/queries';
import { TeamClient } from './team-client';

export default async function TeamPage() {
  const ctx = await requireOrg();
  // Read gate: roles without users_settings read (project_manager/site_engineer/
  // accountant/viewer/client) 404 — the members list carries every colleague's email.
  if (!can(ctx.role, 'users_settings', 'read')) notFound();

  const t = await getTranslations('team');
  const [members, pending] = await Promise.all([
    getOrgMemberIdentities(ctx),
    listPendingInvitations(ctx),
  ]);

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
