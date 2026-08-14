import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { countUnread } from '@/lib/notifications/queries';
import { readOnboarding } from '@/lib/onboarding/merge';
import { listCurrentUserOrgs } from '@/lib/org/queries';

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
  const unreadCount = await countUnread(ctx);

  return (
    <AppShell
      email={user?.email}
      role={ctx.role}
      orgs={orgs}
      activeOrgId={ctx.orgId}
      unreadCount={unreadCount}
      tourSeen={!!onboarding.tourSeen}
      tourStep={onboarding.tourStep ?? null}
    >
      {children}
    </AppShell>
  );
}
