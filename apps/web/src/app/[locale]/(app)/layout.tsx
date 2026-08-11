import { sql } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import type { OrgOption } from '@/components/shell/org-switcher';
import { AppShell } from '@/components/shell/app-shell';
import { requireOrg } from '@/lib/auth/require-org';
import { getSessionUser } from '@/lib/auth/session';
import { withUserContext } from '@/lib/db/context';

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

  const orgs = (await withUserContext(ctx.userId, (tx) =>
    tx.execute(
      sql`select org_id as "orgId", role, name_ar as "nameAr", name_en as "nameEn"
          from public.app_current_user_orgs()
          order by name_en nulls last, name_ar nulls last`,
    ),
  )) as unknown as OrgOption[];

  return (
    <AppShell
      email={user?.email}
      role={ctx.role}
      orgs={orgs}
      activeOrgId={ctx.orgId}
    >
      {children}
    </AppShell>
  );
}
