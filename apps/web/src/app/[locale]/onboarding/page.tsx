import { sql } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { getSessionUser } from '@/lib/auth/session';
import { withUserContext } from '@/lib/db/context';
import { OnboardingWizard } from './wizard';

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  const existing = (await withUserContext(user.id, (tx) =>
    tx.execute(
      sql`select org_id from public.app_current_user_memberships() limit 1`,
    ),
  )) as unknown as unknown[];
  if (existing.length > 0) {
    redirect('/dashboard');
  }

  return (
    <AuthShell showValueProp>
      <OnboardingWizard />
    </AuthShell>
  );
}
