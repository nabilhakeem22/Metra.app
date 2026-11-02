'use client';

import { useTranslations } from 'next-intl';
import { JOURNEY_STEP_ICON } from '@/components/flow/design-step-icons';
import { PhaseRail } from '@/components/flow/phase-rail';
import { JOURNEY_MILESTONES } from '@/lib/engagements/journey-map';
import type { PhaseView } from '@/lib/flow/types';

/**
 * The client's design phase on the shared rail: the six steps in the client's
 * names, never a gate (the view has none for the client). On a phone it is the
 * compact rail: the steps' marks and the current step's name, said once. فصحى copy.
 */
export function DesignRail({ view }: { view: PhaseView }) {
  const t = useTranslations('delivery.journey');
  const labels = Object.fromEntries(JOURNEY_MILESTONES.map((step) => [step, t(step)]));
  return <PhaseRail view={view} labels={labels} icons={JOURNEY_STEP_ICON} compactBelowSm />;
}
