'use client';

import { useTranslations } from 'next-intl';
import {
  JOURNEY_MILESTONES,
  stateMilestone,
} from '@/lib/engagements/journey-map';
import type { DesignState } from '@/lib/engagements/states';

// The command card's 5-stage STEP RIBBON (Proposal · Survey · Concept · 3D ·
// Handover). It reads the client-journey milestone position from the SERVER-SAFE
// leaf `journey-map.ts` (a plain module — no guards barrel, no db runtime — so
// importing it into this client chunk is safe) and lights each segment relative
// to the current milestone index. A closed (abandoned) engagement renders every
// segment muted. Logical CSS only (the flex row + inline-start marks mirror in
// ar-EG RTL); labels are Western-numeral-free text.

type StepStatus = 'done' | 'current' | 'upcoming' | 'muted';

function barClass(status: StepStatus): string {
  switch (status) {
    case 'done':
      return 'bg-brand';
    case 'current':
      return 'bg-brand';
    case 'muted':
      return 'bg-[color:var(--rule)]';
    default:
      return 'bg-[color:var(--track)]';
  }
}

function labelClass(status: StepStatus): string {
  switch (status) {
    case 'current':
      return 'font-semibold text-brand-ink';
    case 'done':
      return 'font-medium text-[color:var(--text-muted)]';
    default:
      return 'text-[color:var(--text-faint)]';
  }
}

export function EngagementStepRibbon({ state }: { state: DesignState }) {
  const t = useTranslations('engagements.ribbon');
  const { index, closed } = stateMilestone(state);

  return (
    <ol className="flex items-stretch gap-1.5">
      {JOURNEY_MILESTONES.map((milestone, position) => {
        const status: StepStatus = closed
          ? 'muted'
          : position < index
            ? 'done'
            : position === index
              ? 'current'
              : 'upcoming';
        return (
          <li
            key={milestone.key}
            className="flex min-w-0 flex-1 flex-col gap-1.5"
            aria-current={status === 'current' ? 'step' : undefined}
          >
            <span
              className={`h-1 rounded-full ${barClass(status)} ${
                status === 'current' ? 'opacity-100' : status === 'done' ? 'opacity-90' : ''
              }`}
              aria-hidden
            />
            <span
              className={`truncate text-[11px] leading-tight ${labelClass(status)}`}
            >
              {t(milestone.key)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
