import { MetraLoader } from '@/components/brand/metra-loader';

// A COLD arrival into the product (first sign-in, accepting an invite): the one
// place the full brand loader belongs. Everything inside the app uses skeletons,
// because a full-screen brand animation on every navigation reads as the
// application restarting, and a client page gets its own shape instead.
export default function Loading() {
  return <MetraLoader />;
}
