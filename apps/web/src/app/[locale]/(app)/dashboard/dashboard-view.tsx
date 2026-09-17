import { useTranslations } from 'next-intl';
import { DeliveriesPanel } from '@/components/dashboard/deliveries-panel';
import { GettingStarted } from '@/components/dashboard/getting-started';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import type { ChartColumn } from '@/lib/dashboard/chart-columns';
import type { DashboardCounts } from '@/lib/dashboard/queries/counts';
import type { DashboardDelivery } from '@/lib/dashboard/queries';
import type { RangeMonths } from '@/lib/dashboard/range';
import type { ChecklistResult } from '@/lib/onboarding/checklist';
import type { MemberRole } from '@/lib/permissions/roles';
import { DashboardCharts } from './dashboard-charts';
import { DashboardFirmCards } from './dashboard-firm-cards';

// A PLAIN module, deliberately NOT 'use client' (A11). `useTranslations` works in
// a server component — eleven files in this repo already do it — and marking this
// 'use client' would pull both donuts, the four stat cards and the deliveries
// panel into the client bundle to make it testable, which is paying a production
// cost for a test convenience.

export interface DashboardIdentity {
  role: MemberRole;
  orgName: { value: string; isFallback: boolean };
  primaryCta: { href: string; messageKey: string };
}

export interface DashboardOnboarding {
  checklist: ChecklistResult;
  orgId: string;
  dismissed: boolean;
}

export interface DashboardFirmBlock {
  counts: DashboardCounts;
  charts: { projects: ChartColumn[]; clients: ChartColumn[] };
  range: RangeMonths;
  canSeeDeliveries: boolean;
  canSeeTeam: boolean;
}

export interface DashboardDeliveriesBlock {
  rows: DashboardDelivery[];
  /** The TRUE count of in-flight deliveries, not rows.length. */
  totalActive: number;
}

export interface DashboardViewProps {
  identity: DashboardIdentity;
  onboarding: DashboardOnboarding;
  /** NULL means the role is not entitled to firm-wide figures. Nothing renders
   *  where the cards were — no locked card, no notice (wave-4 A5). A placeholder
   *  advertises the existence and the shape of figures the firm withheld. */
  firm: DashboardFirmBlock | null;
  /** NULL means the role cannot read engagements at all. */
  deliveries: DashboardDeliveriesBlock | null;
  locale: string;
  /** Passed in so the server renders one consistent "today" for every row. */
  now: Date;
}

/** Eyebrow role pill, org name, greeting; primary CTA at the inline-end. */
function DashboardIdentityHeader({ identity }: { identity: DashboardIdentity }) {
  const d = useTranslations('dashboard');
  const roles = useTranslations('roles');
  const tc = useTranslations('common');
  return (
    <div className="flex items-start justify-between gap-4 px-1.5 py-1">
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant="brand" className="px-2.5 py-[3px]">
            {roles(`${identity.role}.label`)}
          </Badge>
          {identity.orgName.isFallback && <Badge>{tc('untranslated')}</Badge>}
        </span>
        <h1
          className="text-display text-[28px] text-[color:var(--text)]"
          style={{ lineHeight: 1.25 }}
        >
          {identity.orgName.value}
        </h1>
        <p className="text-sm text-[color:var(--text-muted)]">{d('welcomeBack')}</p>
      </div>
      <div className="shrink-0">
        <Button asChild size="lg">
          <Link href={identity.primaryCta.href}>{d(identity.primaryCta.messageKey)}</Link>
        </Button>
      </div>
    </div>
  );
}

export function DashboardView({
  identity,
  onboarding,
  firm,
  deliveries,
  locale,
  now,
}: DashboardViewProps) {
  return (
    <div className="flex flex-col gap-[14px]">
      <DashboardIdentityHeader identity={identity} />

      <GettingStarted
        result={onboarding.checklist}
        orgId={onboarding.orgId}
        dismissed={onboarding.dismissed}
      />

      {firm && <DashboardFirmCards firm={firm} />}

      {deliveries && (
        <DeliveriesPanel
          deliveries={deliveries.rows}
          totalActive={deliveries.totalActive}
          locale={locale}
          now={now}
        />
      )}

      {firm && <DashboardCharts firm={firm} locale={locale} />}
    </div>
  );
}
