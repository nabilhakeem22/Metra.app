import { MetraLoader } from '@/components/brand/metra-loader';

// A COLD arrival — landing, onboarding, a public token portal opening. This is
// the one place the full brand loader belongs; everything under (app) uses
// skeletons instead, because a full-screen brand animation on every in-app
// navigation reads as the application restarting.
export default function Loading() {
  return <MetraLoader />;
}
