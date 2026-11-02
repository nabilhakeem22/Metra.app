import { fireEvent, screen, within, type RenderResult } from '@testing-library/react';
import { useState } from 'react';
import { PortalCommandCard } from '@/app/[locale]/d/[token]/portal/command-card';
import { stateMilestone } from '@/lib/engagements/journey-map';
import type { HeroView } from '@/lib/engagements/portal-hero';
import { PORTAL_STAGE_KEY, type PortalStageKey } from '@/lib/engagements/portal-stage';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import type { DesignState } from '@/lib/engagements/states';
import { messageAt, renderWithIntl, type TestLocale } from './render-with-intl';

// TEST-ONLY. The client page's command card with what the server would hand it,
// and a way to land "the refresh": the props the server returns after an act.
// The callers mock `../actions` and `next/navigation` themselves.

export interface CommandCardProps {
  hero: HeroView;
  clientActions: string[];
  conceptOptions?: PublicDelivery['conceptOptions'];
  conceptChoice?: PublicDelivery['conceptChoice'];
  conceptDecision?: PublicDelivery['conceptDecision'];
  stageKey?: PortalStageKey;
  expectedOn?: PublicDelivery['expectedOn'];
  timeline?: PublicDelivery['timeline'];
  documents?: PublicDelivery['documents'];
  rom?: PublicDelivery['rom'];
  rendersIssuedAt?: PublicDelivery['rendersIssuedAt'];
  paymentSchedule?: PublicDelivery['paymentSchedule'];
  paymentClaim?: PublicDelivery['paymentClaim'];
  paymentDetails?: PublicDelivery['paymentDetails'];
  designDecision?: PublicDelivery['designDecision'];
}

const REFRESH_LABEL = 'land the server refresh';

/** The machine state a client stage word stands for: the journey position follows it. */
function stateOf(stageKey: PortalStageKey): DesignState {
  const states = Object.keys(PORTAL_STAGE_KEY) as DesignState[];
  const state = states.find((candidate) => PORTAL_STAGE_KEY[candidate] === stageKey);
  if (!state) throw new Error(`no state for stage ${stageKey}`);
  return state;
}

export function renderCommandCard(
  initial: CommandCardProps,
  options: { locale?: TestLocale; token?: string; afterRefresh?: CommandCardProps } = {},
): RenderResult {
  function Harness() {
    const [props, setProps] = useState(initial);
    const afterRefresh = options.afterRefresh;
    const stageKey = props.stageKey ?? 'conceptReview';
    return (
      <>
        {afterRefresh && (
          <button type="button" hidden onClick={() => setProps(afterRefresh)}>
            {REFRESH_LABEL}
          </button>
        )}
        <PortalCommandCard
          token={options.token ?? 'tok'}
          delivery={{
            hero: props.hero,
            milestone: stateMilestone(stateOf(stageKey)),
            stageKey,
            paymentSchedule: props.paymentSchedule ?? [],
            paymentClaim: props.paymentClaim ?? null,
            paymentDetails: props.paymentDetails ?? null,
            designDecision: props.designDecision ?? null,
            clientActions: props.clientActions,
            conceptOptions: props.conceptOptions ?? [],
            conceptChoice: props.conceptChoice ?? null,
            conceptDecision: props.conceptDecision ?? null,
            documents: props.documents ?? [],
            rom: props.rom ?? null,
            rendersIssuedAt: props.rendersIssuedAt ?? null,
            expectedOn: props.expectedOn ?? null,
            timeline: props.timeline ?? [],
          }}
        />
      </>
    );
  }
  return renderWithIntl(<Harness />, { locale: options.locale ?? 'en' });
}

/** Re-render with `afterRefresh`, as `router.refresh()` would. */
export function landRefresh(): void {
  fireEvent.click(screen.getByText(REFRESH_LABEL));
}

/** The open confirmation dialog. */
export async function confirmDialog(): Promise<HTMLElement> {
  return screen.findByRole('dialog');
}

/** Press one of the confirmation dialog's two buttons. */
export async function answerDialog(locale: TestLocale, button: 'confirm' | 'cancel'): Promise<void> {
  const dialog = await confirmDialog();
  fireEvent.click(within(dialog).getByRole('button', { name: messageAt(locale, `delivery.actions.${button}`) }));
}
