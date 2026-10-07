import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { loadShellNotificationFeed } from '@/lib/notifications/feed';
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
  const [user, orgs, notificationFeed] = await Promise.all([
    getSessionUser(),
    listCurrentUserOrgs(ctx.userId),
    loadShellNotificationFeed(ctx),
  ]);
  const onboarding = readOnboarding(user?.user_metadata);

  return (
    <AppShell
      email={user?.email}
      role={ctx.role}
      orgs={orgs}
      activeOrgId={ctx.orgId}
      notificationFeed={notificationFeed}
      tourSeen={!!onboarding.tourSeen}
      tourStep={onboarding.tourStep ?? null}
    >
      {children}
    </AppShell>
  );
}
