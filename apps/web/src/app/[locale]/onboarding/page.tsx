import { redirect } from 'next/navigation';
import { AuthShell } from '@/components/auth/auth-shell';
import { getSessionUser } from '@/lib/auth/session';
import { currentUserHasMembership } from '@/lib/org/queries';
import { OnboardingWizard } from './wizard';

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
