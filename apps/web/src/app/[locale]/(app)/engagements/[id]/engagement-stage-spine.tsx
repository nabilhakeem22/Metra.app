'use client';

import { useTranslations } from 'next-intl';
import {
  SPINE_NODES,
  SPINE_STAGES,
  spinePosition,
} from '@/lib/engagements/stage-spine';
import type { DesignState } from '@/lib/engagements/states';

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

function labelClass(status: SegmentStatus): string {
  switch (status) {
    case 'current':
      return 'font-semibold text-brand-ink';
    case 'done':
      return 'font-medium text-[color:var(--text-muted)]';
    default:
      return 'text-[color:var(--text-faint)]';
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
                className={`whitespace-nowrap font-mono text-[9px] font-bold uppercase leading-tight tracking-[0.06em] ${
                  here ? 'text-[color:var(--warn)]' : 'text-[color:var(--text-faint)]'
                }`}
              >
                {t(node.key)}
              </span>
            </li>
          );
        }

        const position = SPINE_STAGES.indexOf(node.key);
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
            <span
              className={`truncate text-[10.5px] leading-tight ${labelClass(status)}`}
            >
              {t(node.key)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
