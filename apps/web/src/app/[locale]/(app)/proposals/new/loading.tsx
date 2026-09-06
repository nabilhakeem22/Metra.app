import { PageSkeleton } from '@/components/loading/page-skeletons';

// The builder is a form, not an index — without this it would inherit the
// proposals list skeleton and flash a table that never arrives.
export default function Loading() {
  return <PageSkeleton />;
}
