import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { countUnread } from '@/lib/notifications/queries';
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
  try {
    return await renderAppLayout({ children });
  } catch (err) {
    // TEMP DIAGNOSTIC: this layout wraps EVERY authenticated page, so a throw
    // here 500s the whole app area with only a digest reaching the browser
    // (Next redacts server-component errors in production). Surface the real
    // stack; re-throw Next's own control-flow signals so requireOrg's redirect()
    // and the client-role notFound() keep working.
    const digest = (err as { digest?: string })?.digest;
    if (
      typeof digest === 'string' &&
      (digest === 'NEXT_NOT_FOUND' || digest.startsWith('NEXT_REDIRECT'))
    ) {
      throw err;
    }
    console.error('[app-layout-diagnostic]', err);
    return (
      <pre className="m-4 overflow-auto whitespace-pre-wrap rounded-lg border p-4 text-xs">
        {`App layout diagnostic (temporary) — the real server error:\n\n${String(
          (err as Error)?.stack ?? err,
        )}`}
      </pre>
    );
  }
}

async function renderAppLayout({ children }: { children: ReactNode }) {
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
