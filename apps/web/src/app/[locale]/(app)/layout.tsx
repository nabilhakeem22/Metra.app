import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell/app-shell';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const ctx = await requireOrg();
  const user = await getSessionUser();

  return (
    <AppShell email={user?.email} role={ctx.role}>
      {children}
    </AppShell>
  );
}
