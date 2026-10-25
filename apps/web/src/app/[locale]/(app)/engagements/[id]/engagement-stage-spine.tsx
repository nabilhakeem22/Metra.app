'use client';

import {
  Box,
  FileText,
  LayoutGrid,
  PackageCheck,
  Palette,
  PenTool,
  Ruler,
  Table2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PhaseRail } from '@/components/flow/phase-rail';
import type { DeliveryStatus } from '@/lib/engagements/delivery-status';
import { SPINE_NODES, type SpineStageKey } from '@/lib/engagements/stage-spine';
import type { DesignState } from '@/lib/engagements/states';
import { buildPhaseView } from '@/lib/flow/build-view';
import { locateDesignForStudio } from '@/lib/flow/locate/design-studio';
import { DESIGN_PHASE } from '@/lib/flow/phases/design';

/**
 * One glyph per stage, in the app's existing Lucide vocabulary.
 *
 * It is DECORATION, never information: every icon sits beside its own text label
 * and is `aria-hidden`, so nothing here is conveyed by shape alone. What it buys
 * is recognition: a glyph reads identically in Arabic and English.
 */
const STAGE_ICON: Readonly<Record<SpineStageKey, LucideIcon>> = {
  proposal: FileText,
  survey: Ruler,
  layout: LayoutGrid,
  concept: Palette,
  threeD: Box,
  shopDrawings: PenTool,
  boq: Table2,
  handover: PackageCheck,
};

// The cockpit's STAGE SPINE: the studio's own design stages on the shared phase
// rail, with the two gates drawn where they actually sit. It is not the client's
// six-milestone journey, which hides the gates on purpose; a studio must see
// Gate A and Gate B on its own engagement.
export function EngagementStageSpine({ state, status }: { state: DesignState; status: DeliveryStatus }) {
  const t = useTranslations('engagements.spine');
  const labels = Object.fromEntries(SPINE_NODES.map((node) => [node.key, t(node.key)]));
  const view = buildPhaseView(DESIGN_PHASE, locateDesignForStudio(state, status), 'studio');
  return <PhaseRail view={view} labels={labels} icons={STAGE_ICON} />;
}
