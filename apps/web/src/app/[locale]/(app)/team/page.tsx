import { invitations } from '@metra/db';
import { eq } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';
import { PageHeader } from '@/components/ui/page-header';
import { requireOrg } from '@/lib/auth/require-org';
import { withOrgContext } from '@/lib/db/context';
import { can } from '@/lib/permissions/can';
import { getOrgMemberIdentities } from '@/lib/team/identities';
import { TeamClient } from './team-client';

export default async function TeamPage() {
  const ctx = await requireOrg();
  const t = await getTranslations('team');

  const members = await getOrgMemberIdentities(ctx);
  const pending = await withOrgContext(ctx, (tx) =>
    tx
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(eq(invitations.status, 'pending')),
  );

  const pendingSerialized = pending.map((p) => ({
    id: p.id,
    email: p.email,
    role: p.role,
    expiresAt: p.expiresAt.toISOString(),
    createdAt: p.createdAt.toISOString(),
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
