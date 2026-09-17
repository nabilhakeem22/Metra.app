import { Compass, FolderKanban, Users, UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { DashboardStatCard } from '@/components/dashboard/dashboard-stat-card';
import type { DashboardFirmBlock } from './dashboard-view';

/**
 * The headline figures, each a link into the module it counts.
 *
 * FIRM-WIDE: this whole component is absent for a role the firm has not entitled
 * to firm figures — the caller renders nothing rather than a locked card.
 */
export function DashboardFirmCards({ firm }: { firm: DashboardFirmBlock }) {
  const d = useTranslations('dashboard');
  return (
    <div className="grid gap-[14px] sm:grid-cols-2 lg:grid-cols-4">
      <DashboardStatCard
        label={d('cards.clients')}
        value={firm.counts.clientsTotal}
        activeLabel={d('cards.active')}
        activeValue={firm.counts.clientsActive}
        icon={Users}
        href="/clients"
      />
      <DashboardStatCard
        label={d('cards.projects')}
        value={firm.counts.projectsTotal}
        activeLabel={d('cards.active')}
        activeValue={firm.counts.projectsActive}
        icon={FolderKanban}
        href="/projects"
      />
      {firm.canSeeDeliveries && (
        <DashboardStatCard
          label={d('cards.deliveries')}
          value={firm.counts.deliveriesTotal}
          activeLabel={d('cards.inFlight')}
          activeValue={firm.counts.deliveriesActive}
          icon={Compass}
          href="/engagements"
        />
      )}
      {firm.canSeeTeam && (
        <DashboardStatCard
          label={d('cards.team')}
          value={firm.counts.teamMembers ?? 0}
          icon={UsersRound}
          href="/team"
        />
      )}
    </div>
  );
}
