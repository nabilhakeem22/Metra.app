import type { LucideIcon } from 'lucide-react';
import type { StepStatus, StepView } from '@/lib/flow/types';
import { WhoseMoveChip } from './whose-move-chip';

// The pieces PhaseRail draws: a step's bar, mark and name with its whose-move
// note, and the gate marker between steps. Like the rail, NOT 'use client' and
// no hooks: every label arrives translated.

/** What a step says under its name: who holds it, and one quiet line. Both translated. */
export interface StepNote {
  who: string;
  caption?: string;
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

/**
 * The name a compact rail leaves to screen readers below sm (640px). Not
 * `max-sm:`: the config's raw `coarse` screen turns Tailwind's max-* variants
 * off, so the query is written out.
 */
const COMPACT_HIDDEN = '[@media(max-width:639.98px)]:sr-only';

/**
 * The gate the job is AT gets the warn accent: that is the difference between
 * "the work before it is in progress" and "it is done and the money is owed".
 */
export function GateMarker({ label, here, compact }: { label: string; here: boolean; compact: boolean }) {
  return (
    <li className="flex flex-none flex-col gap-1.5" aria-current={here ? 'step' : undefined}>
      <span
        aria-hidden
        className={`mx-auto h-1 w-[3px] rounded-full ${here ? 'bg-[color:var(--warn)]' : 'bg-[color:var(--rule)]'}`}
      />
      <span
        className={`whitespace-nowrap text-caption font-bold leading-tight ltr:font-mono ltr:uppercase ltr:tracking-[0.06em] ${
          here ? 'text-[color:var(--warn)]' : 'text-[color:var(--text-faint)]'
        } ${compact ? COMPACT_HIDDEN : ''}`}
      >
        {label}
      </span>
    </li>
  );
}

export function StepSegment({
  step,
  status,
  label,
  Icon,
  note,
  compact,
}: {
  step: StepView;
  status: SegmentStatus;
  label: string;
  Icon: LucideIcon;
  note: StepNote | undefined;
  compact: boolean;
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
          className={`line-clamp-2 min-w-0 text-caption leading-tight md:line-clamp-none md:whitespace-nowrap ${compact ? COMPACT_HIDDEN : ''}`}
          title={label}
        >
          {label}
        </span>
      </span>
      {/* From md up only: on a phone a step is a few dozen pixels wide, a chip
          under it would run into its neighbours, and the card the rail sits on
          already says whose move it is. */}
      {note && (
        <span className="hidden flex-col gap-1.5 md:flex">
          <span data-rail-who>
            <WhoseMoveChip actor={step.actor} status={step.status} label={note.who} />
          </span>
          {note.caption && <span className="text-caption text-[color:var(--text-faint)]">{note.caption}</span>}
        </span>
      )}
    </li>
  );
}
