import { ChevronRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';

// The cockpit's clients > project > delivery trail. A server component, split out
// of `page.tsx` with the reads: what it needs is two ids and two already-resolved
// names, and the page had 24 lines of nav JSX inside a 181-line function.
//
// `rtl:-scale-x-100` on the chevron is the whole RTL story here — the separator
// points the way the text runs, and logical properties do the rest.
export async function EngagementBreadcrumb({
  clientId,
  clientName,
  projectId,
  projectName,
}: {
  clientId: string;
  clientName: string;
  projectId: string;
  projectName: string;
}) {
  const tb = await getTranslations('engagements.breadcrumb');
  return (
    <nav
      aria-label="breadcrumb"
      className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground"
    >
      <Link href="/clients" className="hover:text-foreground">
        {tb('clients')}
      </Link>
      <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
      <Link href={`/clients/${clientId}`} className="hover:text-foreground">
        {clientName}
      </Link>
      <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
      <Link href={`/projects/${projectId}`} className="hover:text-foreground">
        {projectName}
      </Link>
      <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
      <span className="text-foreground">{tb('delivery')}</span>
    </nav>
  );
}
