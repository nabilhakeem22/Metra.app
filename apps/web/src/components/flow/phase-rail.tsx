import { Fragment } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { PhaseView, StepStatus, StepView } from '@/lib/flow/types';
import { WhoseMoveChip } from './whose-move-chip';

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

/** What a step says under its name: who holds it, and one quiet line. Both translated. */
export interface StepNote {
  who: string;
  caption?: string;
}

export interface PhaseRailProps {
  view: PhaseView;
  /** The translated name of every step and gate in the view, by key. */
  labels: Readonly<Record<string, string>>;
  /** The glyph each step carries once reached. Decoration only: it always sits beside its label. */
  icons: Readonly<Record<string, LucideIcon>>;
  /** Per step key, the whose-move chip and caption drawn under its name. */
  notes?: Readonly<Record<string, StepNote>>;
}

/** A closed phase (abandoned, terminated) mutes every step: none of it is reached any more. */
type SegmentStatus = StepStatus | 'muted';

const BAR_CLASS: Readonly<Record<SegmentStatus, string>> = {
  done: 'bg-[color:var(--spine-done)]',
  current: 'bg-brand',
  upcoming: 'bg-[color:var(--track)]',
  muted: 'bg-[color:var(--rule)]',
};

// HIERARCHY BY WEIGHT, NOT BY FADING. Pushing `--text-faint` down until it was
// legible on --track brought it close to --text-muted, which flattens a
// colour-only hierarchy. Weight carries the difference instead, and unlike
// lightness it costs nothing in contrast.
const LABEL_CLASS: Readonly<Record<SegmentStatus, string>> = {
  done: 'font-medium text-[color:var(--text-muted)]',
  current: 'font-bold text-brand-ink',
  upcoming: 'font-normal text-[color:var(--text-faint)]',
  muted: 'font-normal text-[color:var(--text-faint)]',
};

function required<T>(entries: Readonly<Record<string, T>>, key: string, what: string): T {
  const entry = entries[key];
  // developer-only: the message carries a step or gate key from a phase definition, never a person's data.
  if (entry === undefined) throw new Error(`PhaseRail: no ${what} for ${key}`);
  return entry;
}

/**
 * The gate the job is AT gets the warn accent: that is the difference between
 * "the work before it is in progress" and "it is done and the money is owed".
 */
function GateMarker({ label, here }: { label: string; here: boolean }) {
  return (
    <li className="flex flex-none flex-col gap-1.5" aria-current={here ? 'step' : undefined}>
      <span
        aria-hidden
        className={`mx-auto h-1 w-[3px] rounded-full ${here ? 'bg-[color:var(--warn)]' : 'bg-[color:var(--rule)]'}`}
      />
      <span
        className={`whitespace-nowrap text-caption font-bold leading-tight ltr:font-mono ltr:uppercase ltr:tracking-[0.06em] ${
          here ? 'text-[color:var(--warn)]' : 'text-[color:var(--text-faint)]'
        }`}
      >
        {label}
      </span>
    </li>
  );
}

function StepSegment({
  step,
  status,
  label,
  Icon,
  note,
}: {
  step: StepView;
  status: SegmentStatus;
  label: string;
  Icon: LucideIcon;
  note: StepNote | undefined;
}) {
  return (
    <li
      data-rail-step
      className="flex min-w-[52px] flex-[1_1_auto] flex-col gap-1.5 md:min-w-max"
      aria-current={status === 'current' ? 'step' : undefined}
    >
      <span className={`h-1 rounded-full ${BAR_CLASS[status]}`} aria-hidden />
      {/* ICONS WHERE THEY MEAN SOMETHING. A step behind the job and the one it
          is on carry their glyph; a step not reached carries a dot, so the eye
          lands on where the icons stop without reading a word. */}
      <span className={`flex min-w-0 items-start gap-1.5 ${LABEL_CLASS[status]}`}>
        {status === 'done' || status === 'current' ? (
          <Icon className="size-[13px] shrink-0" aria-hidden />
        ) : (
          <span className="size-[5px] shrink-0 rounded-full bg-current opacity-45" aria-hidden />
        )}
        {/* One line from md up: each step takes the width its own name needs
            (flex basis auto). On a phone it may wrap to two lines rather than
            truncate: a clipped name is one nobody can read. The type size never
            shrinks to make it fit. */}
        <span
          data-rail-label
          className="line-clamp-2 min-w-0 text-caption leading-tight md:line-clamp-none md:whitespace-nowrap"
          title={label}
        >
          {label}
        </span>
      </span>
      {note && (
        <>
          <span data-rail-who>
            <WhoseMoveChip actor={step.actor} status={step.status} label={note.who} />
          </span>
          {note.caption && <span className="text-caption text-[color:var(--text-faint)]">{note.caption}</span>}
        </>
      )}
    </li>
  );
}

export function PhaseRail({ view, labels, icons, notes }: PhaseRailProps) {
  return (
    <ol className="flex items-stretch gap-1.5 overflow-x-auto pb-0.5">
      {view.steps.map((step) => (
        <Fragment key={step.key}>
          {step.gateBefore && (
            <GateMarker label={required(labels, step.gateBefore, 'label')} here={view.atGate === step.gateBefore} />
          )}
          <StepSegment
            step={step}
            status={view.status === 'closed' ? 'muted' : step.status}
            label={required(labels, step.key, 'label')}
            Icon={required(icons, step.key, 'icon')}
            note={notes?.[step.key]}
          />
        </Fragment>
      ))}
    </ol>
  );
}
