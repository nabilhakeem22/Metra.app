import { Fragment } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { PhaseView } from '@/lib/flow/types';
import { GateMarker, StepSegment, type StepNote } from './phase-rail-segments';

// The PHASE RAIL: one phase's steps in order, with the gates drawn where they
// sit, generalised from the studio's design stage spine. NOT 'use client', no
// hooks: every label arrives translated, so the studio passes Egyptian copy and
// the client passes MSA through the same rail.
//
// Steps flex to share the row from their own content width; gate markers do
// NOT: they are `flex: none` so they read as thin dividers between segments
// rather than as steps of their own. From md up a step never shrinks below its
// one-line label (`min-w-max`): where the band is narrower than the labels
// (the Arabic design phase needs about 870px) it scrolls sideways instead of
// letting the labels run into each other. Logical CSS only, so the rail mirrors
// in ar-EG RTL without a second layout.
//
// COMPACT BELOW sm (`compactBelowSm`, the client's phone): five names do not fit
// in a phone's card, and a name clipped to "Contr" is one nobody can read. So
// below sm each step keeps its bar and its mark, its name is left to screen
// readers, and the CURRENT step's name is said once, in full, under the rail.

export type { StepNote } from './phase-rail-segments';

export interface PhaseRailProps {
  view: PhaseView;
  /** The translated name of every step and gate in the view, by key. */
  labels: Readonly<Record<string, string>>;
  /** The glyph each step carries once reached. Decoration only: it always sits beside its label. */
  icons: Readonly<Record<string, LucideIcon>>;
  /** Per step key, the whose-move chip and caption drawn under its name (from md up). */
  notes?: Readonly<Record<string, StepNote>>;
  /** Below the sm breakpoint, the compact rail: marks only, and the current step named once under it. */
  compactBelowSm?: boolean;
}

function required<T>(entries: Readonly<Record<string, T>>, key: string, what: string): T {
  const entry = entries[key];
  // developer-only: the message carries a step or gate key from a phase definition, never a person's data.
  if (entry === undefined) throw new Error(`PhaseRail: no ${what} for ${key}`);
  return entry;
}

export function PhaseRail({ view, labels, icons, notes, compactBelowSm = false }: PhaseRailProps) {
  const rail = (
    <ol className="flex items-stretch gap-1.5 overflow-x-auto pb-0.5">
      {view.steps.map((step) => (
        <Fragment key={step.key}>
          {step.gateBefore && (
            <GateMarker
              label={required(labels, step.gateBefore, 'label')}
              here={view.atGate === step.gateBefore}
              compact={compactBelowSm}
            />
          )}
          <StepSegment
            step={step}
            status={view.status === 'closed' ? 'muted' : step.status}
            label={required(labels, step.key, 'label')}
            Icon={required(icons, step.key, 'icon')}
            note={notes?.[step.key]}
            compact={compactBelowSm}
          />
        </Fragment>
      ))}
    </ol>
  );
  if (!compactBelowSm) return rail;
  return (
    <div>
      {rail}
      {/* aria-hidden: each step already names itself to a screen reader. */}
      {view.currentStep && (
        <p data-rail-current-name aria-hidden className="mt-2 text-caption font-bold leading-tight text-brand-ink sm:hidden">
          {required(labels, view.currentStep, 'label')}
        </p>
      )}
    </div>
  );
}
