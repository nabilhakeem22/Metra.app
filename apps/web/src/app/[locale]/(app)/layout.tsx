import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
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
  const user = await getSessionUser();
  const onboarding = readOnboarding(user?.user_metadata);

  const orgs = await listCurrentUserOrgs(ctx.userId);
  // The bell's dropdown is fed from here rather than fetching on open: this layout
  // is a server component that was already counting unread, so the panel costs no
  // extra request and can never be staler than the page it sits on.
  const [unreadCount, recentNotifications] = await Promise.all([
    countUnread(ctx),
    listNotifications(ctx, { limit: 8 }),
  ]);

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
