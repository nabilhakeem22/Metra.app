import type { LucideIcon } from 'lucide-react';
import { StatCard } from '@/components/ui/stat-card';
import { Link } from '@/i18n/routing';

/**
 * One headline dashboard figure. A thin wrapper over the design system's `StatCard`
 * — it adds only the two things the dashboard needs on top: the whole card is a LINK
 * into the module it counts, and the hint line carries the "of which active" figure.
 *
 * A number on a dashboard is really a question ("only 4 active?"), and the answer is
 * always one screen away, so making the card itself the way there beats a separate
 * "view all" control.
 *
 * Counts are rendered LTR: Metra's primary locale is Arabic, and Western numerals
 * inside RTL prose reorder without an explicit direction.
 */
export function DashboardStatCard({
  label,
  value,
  activeLabel,
  activeValue,
  icon: Icon,
  href,
}: {
  label: string;
  value: number;
  /** Omit for a figure with no active/total split (the team card). */
  activeLabel?: string;
  activeValue?: number;
  icon: LucideIcon;
  href: '/clients' | '/projects' | '/team';
}) {
  return (
    <Link
      href={href}
      className="group block rounded-panel focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]"
    >
      <StatCard
        label={label}
        value={String(value)}
        empty="0"
        icon={<Icon className="size-[18px]" aria-hidden />}
        hint={activeLabel ? `${activeLabel} ${activeValue ?? 0}` : undefined}
        className="h-full transition-colors group-hover:border-[color:var(--brand-tint-border)]"
      />
    </Link>
  );
}
