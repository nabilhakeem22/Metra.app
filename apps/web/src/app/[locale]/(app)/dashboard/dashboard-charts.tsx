import { useTranslations } from 'next-intl';
import { DashboardDonut } from '@/components/dashboard/dashboard-donut';
import { DashboardRangeFilter } from '@/components/dashboard/dashboard-range-filter';
import { sliceTotals } from '@/lib/dashboard/chart-columns';
import type { DashboardFirmBlock } from './dashboard-view';

/**
 * The two donuts and the window that reshapes them.
 *
 * The range filter belongs to the charts, so it goes with them: leaving a control
 * that reshapes figures nobody can see would be a dead affordance.
 */
export function DashboardCharts({
  firm,
  locale,
}: {
  firm: DashboardFirmBlock;
  locale: string;
}) {
  const d = useTranslations('dashboard');
  // The arc starts at the reading edge, so ar-EG sweeps from the other end.
  const rtl = locale.startsWith('ar');
  return (
    <>
      <div className="flex items-center justify-end">
        <DashboardRangeFilter active={firm.range} />
      </div>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <DashboardDonut
          title={d('charts.projects')}
          summary={d('charts.projectsSummary', { n: firm.range })}
          emptyLabel={d('charts.empty')}
          totalLabel={d('charts.total')}
          slices={sliceTotals(firm.charts.projects, ['active', 'completed', 'other'])}
          rtl={rtl}
          series={[
            { key: 'active', label: d('charts.statusActive'), token: '--chart-1' },
            { key: 'completed', label: d('charts.statusCompleted'), token: '--chart-2' },
            { key: 'other', label: d('charts.statusOther'), token: '--chart-3' },
          ]}
        />
        <DashboardDonut
          title={d('charts.clients')}
          summary={d('charts.clientsSummary', { n: firm.range })}
          emptyLabel={d('charts.empty')}
          totalLabel={d('charts.total')}
          slices={sliceTotals(firm.charts.clients, ['active', 'inactive'])}
          rtl={rtl}
          series={[
            { key: 'active', label: d('charts.clientActive'), token: '--chart-1' },
            { key: 'inactive', label: d('charts.clientInactive'), token: '--chart-3' },
          ]}
        />
      </div>
    </>
  );
}
