import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { getSessionUser } from '@/lib/auth/session';
import { currentUserHasMembership } from '@/lib/org/queries';
import { PRIVATE_METADATA } from '@/lib/seo/private-metadata';
import { OnboardingWizard } from './wizard';

// Onboarding is an authed, single-org-setup flow — never index it.
export const metadata: Metadata = PRIVATE_METADATA;

export default async function OnboardingPage() {
  const user = await getSessionUser();
  if (!user) {
    redirect('/login');
  }

  if (await currentUserHasMembership(user.id)) {
    redirect('/dashboard');
  }

  return (
    <AuthShell showValueProp>
      <OnboardingWizard />
    </AuthShell>
  );
}
