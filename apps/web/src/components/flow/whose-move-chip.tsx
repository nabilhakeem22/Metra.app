import { StatusChip } from '@/components/ui/status-chip';
import type { Actor, StepStatus } from '@/lib/flow/types';
import { whoseMoveTone } from '@/lib/flow/whose-move-tone';

// NOT 'use client', no hooks: renders in server and client trees alike. The
// label arrives translated (Egyptian for the studio, MSA for the client); the
// tone comes from lib/flow/whose-move-tone.ts.
export function WhoseMoveChip({ actor, status, label }: { actor: Actor; status: StepStatus; label: string }) {
  return <StatusChip tone={whoseMoveTone(actor, status)} label={label} />;
}
