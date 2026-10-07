'use client';

import { useState } from 'react';
import type { CommandCardModel } from './command-card-model';
import { CommandCardAction } from './command-card-action';
import { CommandCardClaims } from './command-card-claims';
import { CommandCardForms } from './command-card-forms';
import type { EngagementCommandCardProps } from './command-card-props';

/**
 * The card's ACT: a pending client claim to confirm, or the one action (pay,
 * advance, the endings) with the forms it can open under it. It owns which of
 * those forms is open.
 */
export function CommandCardActRegion({
  card,
  model,
}: {
  card: EngagementCommandCardProps;
  model: Pick<CommandCardModel, 'view' | 'ctas'>;
}) {
  const { view, ctas } = model;
  const [feeOpen, setFeeOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  return (
    <>
      {ctas.confirmClaims ? (
        <CommandCardClaims
          claims={card.paymentClaims}
          preview={card.preview}
          canAdvance={card.canAdvance}
          pending={card.pending}
          runAction={card.runAction}
        />
      ) : (
        <CommandCardAction
          view={view}
          ctas={ctas}
          waitingOnClient={view.mode === 'blockedClient'}
          canShare={card.canShare}
          pending={card.pending}
          onNudge={card.onNudge}
          onTogglePay={() => setPayOpen((open) => !open)}
          advance={{
            engagementId: card.engagementId,
            preview: card.preview,
            runAction: card.runAction,
            openFeeForm: () => setFeeOpen((open) => !open),
            reviewRoundStartedAt: card.reviewRoundStartedAt,
            conceptOptions: card.conceptOptions,
          }}
        />
      )}

      <CommandCardForms
        engagementId={card.engagementId}
        preview={card.preview}
        view={view}
        ctas={ctas}
        open={{ fee: feeOpen, pay: payOpen }}
        offPlan={{ enabled: card.offPlan, canSet: card.canSetOffPlan }}
        feeSplitPrefill={card.feeSplitPrefill}
        pending={card.pending}
        handlers={{
          runAction: card.runAction,
          closeFee: () => setFeeOpen(false),
          closePay: () => setPayOpen(false),
        }}
      />
    </>
  );
}
