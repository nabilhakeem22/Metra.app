import { PageSkeleton } from '@/components/loading/page-skeletons';

// Covers every (app) route without a closer loading.tsx. The sidebar and top bar
// live in this segment's layout, ABOVE the Suspense boundary, so they stay on
// screen and only the page content is replaced.
export default function Loading() {
  return <PageSkeleton />;
}
