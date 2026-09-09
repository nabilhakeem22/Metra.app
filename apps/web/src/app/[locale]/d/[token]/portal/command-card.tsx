import type { MilestoneProgress } from '@/lib/engagements/journey-map';
import type { HeroView } from '@/lib/engagements/portal-hero';
import type { PortalLabel } from '@/lib/engagements/portal-labels';
import { HeroCard } from './hero-card';
import { JourneyTracker } from './journey-tracker';
import { WhatsNext } from './whats-next';

/**
 * The client's command card — the studio cockpit's anatomy, on the client side.
 *
 * The portal used to stack these three as separate sections, with "what happens
 * next" at the BOTTOM of the page: five cards below the button it describes. The
 * rule the cockpit card is built on is that the one action never reads as a dead
 * end, and a next-step card that far away does not do that job.
 *
 * So they are one card now, read top to bottom, every time:
 *   1. where we are      — the five-milestone ribbon
 *   2. the one thing now — the hero's single CTA (or its calm in-progress state)
 *   3. what happens next — one quiet line, directly under the action
 *
 * Everything else — documents, payments, the claim — stays below, exactly as it
 * was. This is a re-layout, not a new engine: the same three components, the same
 * props, the same server actions behind them.
 */
export function PortalCommandCard({
  token,
  hero,
  milestone,
  stageLabel,
  stageNote,
}: {
  token: string;
  hero: HeroView;
  milestone: MilestoneProgress;
  stageLabel: PortalLabel;
  stageNote: PortalLabel;
}) {
  return (
    <section className="space-y-4 rounded-2xl border bg-background p-4 shadow-sm">
      <JourneyTracker milestone={milestone} bare />
      <HeroCard
        token={token}
        hero={hero}
        stageLabel={stageLabel}
        stageNote={stageNote}
      />
      <WhatsNext milestone={milestone} bare />
    </section>
  );
}
