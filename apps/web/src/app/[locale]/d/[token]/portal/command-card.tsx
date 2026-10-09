'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { MilestoneProgress } from '@/lib/engagements/journey-map';
import type { HeroView } from '@/lib/engagements/portal-hero';
import type { PortalStageKey } from '@/lib/engagements/portal-stage';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { HeroCard, type HeroLastAnswer } from './hero-card';
import { JourneyTracker } from './journey-tracker';
import { WhatsNext } from './whats-next';

/**
 * The client's command card — the studio cockpit's anatomy, on the client side,
 * read top to bottom, every time:
 *   1. where we are      — the six-milestone ribbon
 *   2. the one thing now — the hero's single CTA (or its calm in-progress state)
 *   3. what happens next — one quiet line, directly under the action
 *
 * It OWNS the client's last confirmed answer. Every confirmed act re-reads the
 * page from the server (`router.refresh()`), so the journey, the hero and the
 * cards below show where things stand now; the answer is held here, above the
 * hero that gave it, so the confirmation survives that refresh.
 */
export function PortalCommandCard({
  token,
  hero,
  milestone,
  stageKey,
  concept,
}: {
  token: string;
  hero: HeroView;
  milestone: MilestoneProgress;
  stageKey: PortalStageKey;
  /** What the hero needs to offer the concept options as a choice (B12). */
  concept: Pick<PublicDelivery, 'clientActions' | 'conceptOptions' | 'conceptChoice'>;
}) {
  const router = useRouter();
  const [lastAnswer, setLastAnswer] = useState<HeroLastAnswer | null>(null);

  function answered(answer: HeroLastAnswer) {
    setLastAnswer(answer);
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-panel border bg-background p-4 shadow-sm">
      <JourneyTracker milestone={milestone} bare />
      <HeroCard
        token={token}
        hero={hero}
        stageKey={stageKey}
        clientActions={concept.clientActions}
        conceptOptions={concept.conceptOptions}
        conceptChoice={concept.conceptChoice}
        lastAnswer={lastAnswer}
        onAnswered={answered}
      />
      <WhatsNext milestone={milestone} bare />
    </section>
  );
}
