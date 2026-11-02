import { Box, FileText, LayoutGrid, PackageCheck, Palette, PenTool, Ruler, Table2, type LucideIcon } from 'lucide-react';
import type { JourneyMilestoneKey } from '@/lib/engagements/journey-map';
import type { SpineStageKey } from '@/lib/engagements/stage-spine';

// One glyph per design stage and per client step, for the studio's spine and the
// client's rail. A plain module (never 'use client'), so either tree imports it.
// Decoration only: each sits beside its own label and is aria-hidden, and a glyph
// reads identically in Arabic and English.

/** The studio's eight design stages. */
export const DESIGN_STAGE_ICON: Readonly<Record<SpineStageKey, LucideIcon>> = {
  proposal: FileText,
  survey: Ruler,
  layout: LayoutGrid,
  concept: Palette,
  threeD: Box,
  shopDrawings: PenTool,
  boq: Table2,
  handover: PackageCheck,
};

/** The client's six steps: each wears the glyph of the first studio stage it groups. */
export const JOURNEY_STEP_ICON: Readonly<Record<JourneyMilestoneKey, LucideIcon>> = {
  proposal: FileText,
  survey: Ruler,
  concept: Palette,
  design: Box,
  documents: PenTool,
  handover: PackageCheck,
};
