'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { StepCard } from '@/components/flow/step-card';
import { clientMoveTone } from '@/lib/client-home/hero';
import { commandCardChromeForTone } from '@/lib/engagements/command-card-chrome';
import { buildPhaseView } from '@/lib/flow/build-view';
import { awaitedDesignFee, locateDesignForClient, type ClientDesignFacts } from '@/lib/flow/locate/design-client';
import { DESIGN_PHASE } from '@/lib/flow/phases/design';
import { DesignFeeWait } from './design-fee-wait';
import { DesignRail } from './design-rail';
import { HeroCard, type HeroLastAnswer, type HeroReview } from './hero-card';
import { WhatsNext } from './whats-next';

/** What the card reads off the delivery: where it stands, and what its hero reads. */
type CommandCardFacts = ClientDesignFacts & HeroReview;

/**
 * The client's command card: the shared step card, read top to bottom every time:
 *   1. where we are      (the design rail, wearing whose move it is)
 *   2. the one thing now (the hero's single act, or its calm state, and the
 *                         instalment the next step waits on, if any)
 *   3. what happens next (one quiet line, directly under the action)
 *
 * One location per render, so the rail, the card's colour and the next line can
 * never disagree. It OWNS the client's last confirmed answer: every confirmed act
 * re-reads the page from the server (`router.refresh()`), and the answer is held
 * here, above the hero that gave it, so the confirmation survives that refresh.
 */
export function PortalCommandCard({ token, delivery }: { token: string; delivery: CommandCardFacts }) {
  const router = useRouter();
  const [lastAnswer, setLastAnswer] = useState<HeroLastAnswer | null>(null);

  function answered(answer: HeroLastAnswer) {
    setLastAnswer(answer);
    router.refresh();
  }

  const location = locateDesignForClient(delivery);
  const view = buildPhaseView(DESIGN_PHASE, location, 'client');
  const fee = delivery.hero.kind === 'action' ? null : awaitedDesignFee(delivery);

  return (
    <StepCard chrome={commandCardChromeForTone(clientMoveTone(location))} rail={<DesignRail view={view} />}>
      <div className="space-y-4" data-design-step={location.step ?? 'none'} data-whose-move={location.whoseMove ?? 'none'}>
        <HeroCard
          token={token}
          hero={delivery.hero}
          stageKey={delivery.stageKey}
          review={delivery}
          lastAnswer={lastAnswer}
          onAnswered={answered}
          feeAwaited={fee !== null}
        />
        {fee && <DesignFeeWait kind={fee} />}
        <WhatsNext view={view} />
      </div>
    </StepCard>
  );
}
