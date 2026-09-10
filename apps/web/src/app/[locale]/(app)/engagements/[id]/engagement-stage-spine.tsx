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
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  SPINE_NODES,
  SPINE_STAGES,
  type SpineStageKey,
  spinePosition,
} from '@/lib/engagements/stage-spine';
import type { DesignState } from '@/lib/engagements/states';

/**
 * One glyph per stage, in the app's existing Lucide vocabulary.
 *
 * It is DECORATION, never information: every icon sits beside its own text label
 * and is `aria-hidden`, so nothing here is conveyed by shape alone. What it buys
 * is recognition — a glyph reads identically in Arabic and English, which makes
 * it the one label on this band that needs no translation.
 */
const STAGE_ICON: Record<SpineStageKey, typeof FileText> = {
  proposal: FileText,
  survey: Ruler,
  layout: LayoutGrid,
  concept: Palette,
  threeD: Box,
  shopDrawings: PenTool,
  boq: Table2,
  handover: PackageCheck,
};

// The cockpit's STAGE SPINE — the studio's own stages, with the two gates drawn
// where they actually sit. It replaces the five-milestone ribbon, which is the
// CLIENT's journey map: that one collapses sixteen states into friendly
// milestones and hides the gates on purpose, so a studio was looking at its own
// engagement through the homeowner's simplification with Gate A and Gate B
// nowhere on the page.
//
// Stages flex to share the row; gate markers do NOT — they are `flex: none` so
// they read as thin dividers between segments rather than as stages of their own.
// The row scrolls horizontally on a narrow screen rather than crushing ten labels
// into illegibility. Logical CSS only, so the whole spine mirrors in ar-EG RTL
// without a second layout.

type SegmentStatus = 'done' | 'current' | 'upcoming' | 'muted';

function barClass(status: SegmentStatus): string {
  switch (status) {
    case 'done':
      return 'bg-brand opacity-90';
    case 'current':
      return 'bg-brand';
    case 'muted':
      return 'bg-[color:var(--rule)]';
    default:
      return 'bg-[color:var(--track)]';
  }
}

// HIERARCHY BY WEIGHT, NOT BY FADING. Pushing `--text-faint` down until it was
// legible on --track brought it close to --text-muted, which flattens a
// colour-only hierarchy. Weight carries the difference instead -- and unlike
// lightness it costs nothing in contrast, which is the whole point.
function labelClass(status: SegmentStatus): string {
  switch (status) {
    case 'current':
      return 'font-bold text-brand-ink';
    case 'done':
      return 'font-medium text-[color:var(--text-muted)]';
    default:
      return 'font-normal text-[color:var(--text-faint)]';
  }
}

export function EngagementStageSpine({ state }: { state: DesignState }) {
  const t = useTranslations('engagements.spine');
  const { index, allComplete, closed, atGate } = spinePosition(state);

  return (
    <ol className="flex items-stretch gap-1.5 overflow-x-auto pb-0.5">
      {SPINE_NODES.map((node) => {
        if (node.kind === 'gate') {
          // The gate the engagement is AT gets the warn accent — that is the
          // difference between "the 3D is in progress" and "the 3D is done and
          // the client owes us an approval".
          const here = atGate === node.key;
          return (
            <li
              key={node.key}
              className="flex flex-none flex-col gap-1.5"
              aria-current={here ? 'step' : undefined}
            >
              <span
                aria-hidden
                className={`mx-auto h-1 w-[3px] rounded-full ${
                  here ? 'bg-[color:var(--warn)]' : 'bg-[color:var(--rule)]'
                }`}
              />
              <span
                className={`whitespace-nowrap font-mono text-[10px] font-bold uppercase leading-tight tracking-[0.06em] ${
                  here ? 'text-[color:var(--warn)]' : 'text-[color:var(--text-faint)]'
                }`}
              >
                {t(node.key)}
              </span>
            </li>
          );
        }

        const position = SPINE_STAGES.indexOf(node.key);
        const Icon = STAGE_ICON[node.key];
        const status: SegmentStatus = closed
          ? 'muted'
          : allComplete || position < index
            ? 'done'
            : position === index
              ? 'current'
              : 'upcoming';

        return (
          <li
            key={node.key}
            className="flex min-w-[52px] flex-1 flex-col gap-1.5"
            aria-current={status === 'current' ? 'step' : undefined}
          >
            <span className={`h-1 rounded-full ${barClass(status)}`} aria-hidden />
            {/* ICONS WHERE THEY MEAN SOMETHING. A stage you have finished and the
                one you are on carry their glyph; a stage you have not reached
                carries a dot. The spine stops being a decorated list and becomes a
                POSITION — the eye lands on where the icons stop, which is legible
                without reading a single word. A muted (abandoned) engagement takes
                dots throughout: none of it is "reached" any more. */}
            <span
              className={`flex min-w-0 items-center gap-1.5 ${labelClass(status)}`}
            >
              {status === 'done' || status === 'current' ? (
                <Icon className="size-[13px] shrink-0" aria-hidden />
              ) : (
                <span
                  className="size-[5px] shrink-0 rounded-full bg-current opacity-45"
                  aria-hidden
                />
              )}
              <span className="truncate text-[11px] leading-tight">
                {t(node.key)}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
