import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { daysSince, deliveryWaitingOn, isStale } from '@/lib/dashboard/deliveries';
import type { DashboardDelivery } from '@/lib/dashboard/queries';
import { SPINE_NODES, spinePosition } from '@/lib/engagements/stage-spine';
import { formatNumber } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';

/**
 * The deliveries still in flight, on the dashboard.
 *
 * NOT the Deliveries table. That table is a REGISTER — it leads with a document
 * number and sorts newest-first, which is right for something you search. This
 * panel has one job: say which delivery needs the studio today. So it sorts by
 * longest untouched (done in the query), leads with the client rather than
 * `DE-2026-0014`, and shows who is holding each one up.
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
  locale,
  now,
}: {
  deliveries: DashboardDelivery[];
  /** Everything in flight, so the header can say what the cap is hiding. */
  totalActive: number;
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
          <span className="rounded-pill bg-[color:var(--brand-tint)] px-2 py-1 font-mono text-[11px] font-bold text-[color:var(--brand-ink)]">
            {totalActive}
          </span>
        </h2>
        <Link
          href="/engagements"
          className="ms-auto inline-flex items-center gap-1 text-sm font-semibold text-[color:var(--brand-ink)] hover:underline"
        >
          {t('viewAll')}
          <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
        </Link>
      </div>

      {deliveries.length === 0 ? (
        <p className="p-8 text-center text-sm text-[color:var(--text-muted)]">
          {t('empty')}
        </p>
      ) : (
        <ul>
          {deliveries.map((d) => {
            const pos = spinePosition(d.state);
            const days = daysSince(d.updatedAt, now);
            const stale = isStale(days);
            const waiting = deliveryWaitingOn(d.state);
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
            const stageKey = SPINE_NODES.filter((n) => n.kind === 'stage')[
              pos.index
            ]?.key;

            return (
              <li key={d.id} className="border-b border-[color:var(--rule-soft)] last:border-0">
                <Link
                  href={`/engagements/${d.id}`}
                  className="grid grid-cols-[1fr_auto] items-center gap-4 p-4 hover:bg-[color:var(--track)] sm:grid-cols-[1fr_132px_auto_96px]"
                >
                  <span className="min-w-0">
                    <span
                      className="block truncate font-bold text-[color:var(--text)]"
                      dir="auto"
                    >
                      {client || '—'}
                    </span>
                    <span
                      className="block truncate text-[13px] text-[color:var(--text-muted)]"
                      dir="auto"
                    >
                      {project || '—'}
                    </span>
                  </span>

                  {/* The spine, compressed. Hidden on the narrowest screens —
                      the stage name below it carries the same fact in words. */}
                  <span className="hidden sm:block">
                    <Ribbon position={pos} />
                    <span className="mt-1 block whitespace-nowrap font-mono text-[11px] text-[color:var(--text-faint)]">
                      {stageKey ? spine(stageKey) : '—'}
                      {pos.atGate ? ` · ${spine(pos.atGate)}` : ''}
                    </span>
                  </span>

                  <span className="hidden sm:block">
                    <span
                      className="whitespace-nowrap rounded-pill px-2 py-1 text-[11.5px] font-bold"
                      style={
                        waiting === 'client'
                          ? { background: 'var(--warn-tint)', color: 'var(--warn)' }
                          : {
                              background: 'var(--brand-tint)',
                              color: 'var(--brand-ink)',
                            }
                      }
                    >
                      {waiting === 'client' ? t('waitingClient') : t('waitingStudio')}
                    </span>
                  </span>

                  <span
                    className="whitespace-nowrap text-end font-mono text-xs"
                    style={{
                      color: stale ? 'var(--danger)' : 'var(--text-muted)',
                      fontWeight: stale ? 700 : 400,
                    }}
                  >
                    {days === 0
                      ? t('today')
                      : /* The count drives the plural; the DISPLAYED number is
                           pre-formatted, because next-intl is configured with a
                           bare `ar-EG` locale and ICU's `#` would render
                           Arabic-Indic digits — the app uses Latin digits in
                           both locales (lib/format/number.ts). */
                        t('sinceDays', {
                          count: days,
                          n: formatNumber(days, locale),
                        })}
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

/**
 * Eight stage marks and the two gates between them.
 *
 * Wide marks are stages, narrow uprights are gates. An AMBER upright says the
 * delivery is sitting AT that gate — the design is done and the approval or the
 * instalment is not, which is a different situation from "the 3D is in progress"
 * and the one that decides whether the studio picks up the phone.
 *
 * Purely decorative: every row states its stage in words underneath and its
 * blocker in the badge beside it, so nothing here is carried by shape or colour
 * alone.
 */
// NOTE: --brand is an HSL TRIPLET (`220 79% 54%`), not a colour, so it must be
// wrapped in hsl(). Written bare it silently resolves to nothing and every
// "done" mark renders as an empty box — which is exactly how this shipped the
// first time. The direct-colour tokens (--rule, --warn, --brand-tint, …) are
// used as-is; only the shadcn triplets need the wrapper.
function Ribbon({
  position,
}: {
  position: ReturnType<typeof spinePosition>;
}) {
  let stageIndex = -1;
  return (
    <span className="flex items-center gap-1" aria-hidden>
      {SPINE_NODES.map((node) => {
        if (node.kind === 'stage') {
          stageIndex += 1;
          const done = position.allComplete || stageIndex < position.index;
          const here = !position.allComplete && stageIndex === position.index;
          return (
            <span
              key={node.key}
              className="block h-1 w-[9px] rounded-sm"
              style={{
                background:
                  done || here ? 'hsl(var(--brand))' : 'var(--rule)',
                boxShadow: here ? '0 0 0 2px var(--brand-tint)' : undefined,
                opacity: position.closed ? 0.4 : 1,
              }}
            />
          );
        }
        // The gate sits AFTER the stage just drawn, so it is behind us only
        // once the current stage is past that one.
        const at = position.atGate === node.key;
        const passed = position.allComplete || position.index > stageIndex;
        return (
          <span
            key={node.key}
            className="block h-[9px] w-1 rounded-[1px]"
            style={{
              background: at
                ? 'var(--warn)'
                : passed
                  ? 'hsl(var(--brand))'
                  : 'var(--rule)',
              boxShadow: at ? '0 0 0 2px var(--warn-tint)' : undefined,
              opacity: position.closed ? 0.4 : 1,
            }}
          />
        );
      })}
    </span>
  );
}
