// Which status tone a step's whose-move chip wears. PURE and CLIENT-SAFE: the
// rule lives here, components/flow/whose-move-chip.tsx only paints it. Brand is
// reserved for the studio's own move (lib/ui/status-tone.ts); a move held by the
// client or the site reads as waiting.
import type { StatusTone } from '@/lib/ui/status-tone';
import type { Actor, StepStatus } from './types';

const CURRENT_TONE: Readonly<Record<Actor, StatusTone>> = {
  studio: 'yourMove',
  client: 'waiting',
  site: 'neutral',
};

export function whoseMoveTone(actor: Actor, status: StepStatus): StatusTone {
  if (status === 'done') return 'done';
  return status === 'current' ? CURRENT_TONE[actor] : 'neutral';
}
