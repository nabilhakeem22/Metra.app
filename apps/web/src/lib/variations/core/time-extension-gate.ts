import 'server-only';
// A time extension is an execution feature (plan A1, A24): only a change order
// of a contract generated from a BOQ carries one. A proposal contract's order
// stays exactly as it was before Stage 2, so a directly invoked action that
// names days on one is refused, never stored.
import { fail } from '@/lib/actions/mutate';

export function refuseExtensionOffExecution(days: number | null | undefined, sourceBoqId: string | null): void {
  if (days != null && sourceBoqId === null) fail('contract_not_execution');
}
