'use client';

import { useTranslations } from 'next-intl';
import { DESIGN_STAGE_ICON } from '@/components/flow/design-step-icons';
import { PhaseRail } from '@/components/flow/phase-rail';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import { SPINE_NODES } from '@/lib/engagements/stage-spine';
import type { DesignState } from '@/lib/engagements/states';
import { buildPhaseView } from '@/lib/flow/build-view';
import { locateDesignForStudio } from '@/lib/flow/locate/design-studio';
import { DESIGN_PHASE } from '@/lib/flow/phases/design';

// The cockpit's STAGE SPINE: the studio's own design stages on the shared phase
// rail, with the two gates drawn where they actually sit. It is not the client's
// design rail, which hides the gates on purpose; a studio must see Gate A and
// Gate B on its own engagement.
export function EngagementStageSpine({ state, status }: { state: DesignState; status: DeliveryStatus }) {
  const t = useTranslations('engagements.spine');
  const labels = Object.fromEntries(SPINE_NODES.map((node) => [node.key, t(node.key)]));
  const view = buildPhaseView(DESIGN_PHASE, locateDesignForStudio(state, status), 'studio');
  return <PhaseRail view={view} labels={labels} icons={DESIGN_STAGE_ICON} />;
}
