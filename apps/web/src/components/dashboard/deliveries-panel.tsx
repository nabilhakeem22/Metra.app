import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { DeliveryAgeLabel } from '@/components/engagements/delivery-age-label';
import { WhoseMoveChip } from '@/components/engagements/whose-move-chip';
import type { DashboardDelivery } from '@/lib/dashboard/queries';
import type { DeliveriesEmptyState } from '@/lib/dashboard/setup-step';
import { spineStageKeyOf, spinePosition } from '@/lib/engagements/stage-spine';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { DeliveriesPanelEmpty } from './deliveries-panel-empty';
import { DeliveryRibbon } from './delivery-ribbon';

/**
 * The deliveries still in flight, on the dashboard.
 *
 * NOT the Deliveries table. That table is a REGISTER — it leads with a document
 * number and sorts newest-first, which is right for something you search. This
 * panel has one job: say which delivery needs the studio today. So it sorts by
 * longest untouched (done in the query), leads with the client rather than
 * `DE-2026-0014`, and shows whose move it is by the delivery page's own rule
 * (`whose-move.ts`), so the two can never disagree.
 *
 * The stage ribbon is the delivery page's own spine compressed to row height —
 * the same eight stages and two gates, read from the same `spinePosition`. A
 * dashboard that invented a second notion of progress would eventually disagree
 * with the page it links to.
 *
 * A percentage was the obvious alternative and the wrong one: "60% complete" is
 * not a thing anyone in a studio says, and it cannot express "sitting at Gate B",
 * which is the single most actionable state a delivery can be in.
 */
export async function DeliveriesPanel({
  deliveries,
  totalActive,
  empty,
  locale,
  now,
}: {
  deliveries: DashboardDelivery[];
  /** Everything in flight, so the header can say what the cap is hiding. */
  totalActive: number;
  /** What to say, and where to point, when nothing is in flight. */
  empty: DeliveriesEmptyState;
  locale: string;
  /** Passed in so the server renders one consistent "today" for every row. */
  now: Date;
}) {
  const t = await getTranslations('dashboard.deliveries');
  const spine = await getTranslations('engagements.spine');

  return (
    <section className="overflow-hidden rounded-panel border border-[color:var(--rule)] bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--rule)] p-4">
        <h2 className="flex items-center gap-2 font-bold text-[color:var(--text)]">
          {t('title')}
          <span className="rounded-pill bg-[color:var(--brand-tint)] px-2 py-1 font-mono text-caption font-bold text-[color:var(--brand-ink)]">
            {totalActive}
          </span>
        </h2>
        <Link
          href="/engagements"
          className="ms-auto inline-flex items-center gap-1 text-body font-semibold text-[color:var(--brand-ink)] hover:underline"
        >
          {t('viewAll')}
          <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>

      {deliveries.length === 0 ? (
        <DeliveriesPanelEmpty empty={empty} />
      ) : (
        <ul>
          {deliveries.map((d) => {
            const pos = spinePosition(d.state);
            const client = pickLocale(
              { nameAr: d.clientNameAr, nameEn: d.clientNameEn },
              'name',
              locale,
            ).value;
            const project = pickLocale(
              { nameAr: d.projectNameAr, nameEn: d.projectNameEn },
              'name',
              locale,
            ).value;

            return (
              <li key={d.id} className="border-b border-[color:var(--rule-soft)] last:border-0">
                <Link
                  href={`/engagements/${d.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 p-4 hover:bg-[color:var(--track)] sm:grid-cols-[1fr_132px_auto_96px]"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-[color:var(--text)]">
                      <bdi>{client || '—'}</bdi>
                    </span>
                    <span className="block truncate text-small text-[color:var(--text-muted)]">
                      <bdi>{project || '—'}</bdi>
                    </span>
                  </span>

                  {/* The spine, compressed. Hidden on the narrowest screens: the
                      whose-move chip and the age still show there. */}
                  <span className="hidden sm:block">
                    <DeliveryRibbon position={pos} />
                    <span className="mt-1 block whitespace-nowrap font-mono text-caption text-[color:var(--text-faint)]">
                      {spine(spineStageKeyOf(d.state))}
                      {pos.atGate ? ` · ${spine(pos.atGate)}` : ''}
                    </span>
                  </span>

                  {/* Whose move, by the delivery page's own rule. Shown on phones
                      too: it is the one fact this panel exists to say. */}
                  <span>
                    <WhoseMoveChip whoseMove={d.whoseMove} />
                  </span>

                  <span className="text-end">
                    <DeliveryAgeLabel updatedAt={d.updatedAt} now={now} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
