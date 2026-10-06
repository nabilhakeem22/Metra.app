import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { loggableFailure } from '@/lib/actions/loggable-failure';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { countUnread, listNotifications } from '@/lib/notifications/queries';
import { readOnboarding } from '@/lib/onboarding/merge';
import { listCurrentUserOrgs } from '@/lib/org/queries';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';

// The authed shell and everything under it is private — never index it.
export const metadata: Metadata = PRIVATE_METADATA;

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await requireOrg();
  // The 'client' role belongs to the P4 client portal, not the internal shell —
  // deny it the whole (app) area (defense-in-depth beyond per-page read gates).
  if (ctx.role === 'client') notFound();
  // One round of reads, in parallel. The bell's dropdown is fed from here rather
  // than fetching on open: the panel costs no extra request and can never be
  // staler than the page it sits on. The bell is not worth the shell: a failed
  // notification read shows an empty bell, never an error page.
  const [user, orgs, bell] = await Promise.all([
    getSessionUser(),
    listCurrentUserOrgs(ctx.userId),
    Promise.allSettled([countUnread(ctx), listNotifications(ctx, { limit: 8 })]),
  ]);
  const [unreadRead, recentRead] = bell;
  for (const read of bell) {
    if (read.status === 'rejected') {
      console.error('app shell: notification read failed', loggableFailure(read.reason));
    }
  }
  const unreadCount = unreadRead.status === 'fulfilled' ? unreadRead.value : 0;
  const recentNotifications = recentRead.status === 'fulfilled' ? recentRead.value : [];
  const onboarding = readOnboarding(user?.user_metadata);

  return (
    <AppShell
      email={user?.email}
      role={ctx.role}
      orgs={orgs}
      activeOrgId={ctx.orgId}
      unreadCount={unreadCount}
      notifications={recentNotifications.map((n) => ({
        id: n.id,
        kind: n.kind,
        bodyKey: n.bodyKey,
        params: (n.params ?? {}) as Record<string, unknown>,
        entityType: n.entityType,
        entityId: n.entityId,
        createdAt: n.createdAt.toISOString(),
        read: n.readAt !== null,
      }))}
      tourSeen={!!onboarding.tourSeen}
      tourStep={onboarding.tourStep ?? null}
    >
      {children}
    </AppShell>
  );
}
