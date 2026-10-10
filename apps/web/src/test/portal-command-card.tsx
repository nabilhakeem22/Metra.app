import { fireEvent, screen, within, type RenderResult } from '@testing-library/react';
import { useState } from 'react';
import { PortalCommandCard } from '@/app/[locale]/d/[token]/portal/command-card';
import { stateMilestone } from '@/lib/engagements/journey-map';
import type { HeroView } from '@/lib/engagements/portal-hero';
import type { PortalStageKey } from '@/lib/engagements/portal-stage';
import type { PublicDelivery } from '@/lib/engagements/public/types';
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
}

const REFRESH_LABEL = 'land the server refresh';

export function renderCommandCard(
  initial: CommandCardProps,
  options: { locale?: TestLocale; token?: string; afterRefresh?: CommandCardProps } = {},
): RenderResult {
  function Harness() {
    const [props, setProps] = useState(initial);
    const afterRefresh = options.afterRefresh;
    return (
      <>
        {afterRefresh && (
          <button type="button" hidden onClick={() => setProps(afterRefresh)}>
            {REFRESH_LABEL}
          </button>
        )}
        <PortalCommandCard
          token={options.token ?? 'tok'}
          hero={props.hero}
          milestone={stateMilestone('concept_review')}
          stageKey={props.stageKey ?? 'conceptReview'}
          review={{
            clientActions: props.clientActions,
            conceptOptions: props.conceptOptions ?? [],
            conceptChoice: props.conceptChoice ?? null,
            conceptDecision: props.conceptDecision ?? null,
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
