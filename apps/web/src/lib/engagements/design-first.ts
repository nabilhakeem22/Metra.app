// Design first, one link (owner ruling, Nov 2 2026): a client on a project has
// one delivery row, so one link, and the contract from the BOQ starts only once
// design has finished on it. THE rule, answered from the deliveries of a
// (project, client) pair. PURE and CLIENT-SAFE: the cores call it through
// ./pair-home.ts, and the screens read their refusal sentence from it.
import type { MessageParams } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import type { EntryPhase } from '@/lib/flow/types';
import { docYear, formatDocNumber } from '@/lib/format/doc-number';
import { ACTIVE_STATES, type DesignState } from './states';

export interface PairDelivery {
  id: string;
  number: number;
  createdAt: string | Date;
  state: DesignState;
  entryPhase: EntryPhase;
}

/** Where a pair stands against execution. `home` is the delivery whose link shows the contract. */
export type ExecutionGate =
  | { kind: 'no_delivery' }
  | { kind: 'design_open'; delivery: PairDelivery }
  | { kind: 'design_only_closed'; delivery: PairDelivery }
  | { kind: 'home'; delivery: PairDelivery };

/**
 * The gate, in this order: any active state is `design_open`, else `execution`
 * is `home` (the lowest number), else `closed_design_only`, else `no_delivery`.
 * Abandoned rows are ignored. The order matters only for old rows: a pair holds
 * one non-abandoned delivery from this rule on (./delivery-slot.ts).
 */
export function executionGateOf(deliveries: readonly PairDelivery[]): ExecutionGate {
  const byNumber = [...deliveries].sort((a, b) => a.number - b.number);
  const open = byNumber.find((delivery) => ACTIVE_STATES.has(delivery.state));
  if (open) return { kind: 'design_open', delivery: open };
  const executing = byNumber.find((delivery) => delivery.state === 'execution');
  if (executing) return { kind: 'home', delivery: executing };
  const closed = byNumber.find((delivery) => delivery.state === 'closed_design_only');
  if (closed) return { kind: 'design_only_closed', delivery: closed };
  return { kind: 'no_delivery' };
}

/** MessageParams of every design-first refusal. `delivery` is DE-YYYY-NNNN. */
export interface DesignFirstTarget extends MessageParams {
  delivery: string;
  deliveryId: string;
}

export type DesignFirstRefusal = { code: 'design_open' | 'design_only_closed'; params: DesignFirstTarget };

/** DE-YYYY-NNNN, as a refusal names the delivery. */
export function deliveryDocumentNumber(delivery: Pick<PairDelivery, 'number' | 'createdAt'>): string {
  return formatDocNumber('DE', delivery.number, docYear(null, delivery.createdAt));
}

/** The delivery as a refusal names it, and links to it. */
export function designFirstTargetFor(delivery: PairDelivery): DesignFirstTarget {
  return { delivery: deliveryDocumentNumber(delivery), deliveryId: delivery.id };
}

/** Why execution cannot start on this pair yet; null when design is finished, or never ran. */
export function designFirstRefusal(gate: ExecutionGate): DesignFirstRefusal | null {
  if (gate.kind !== 'design_open' && gate.kind !== 'design_only_closed') return null;
  return { code: gate.kind, params: designFirstTargetFor(gate.delivery) };
}

/** A contract from this BOQ would appear on the pair's one link. */
function boqIsOnHome(gate: ExecutionGate, boq: { engagementId: string | null }): boolean {
  if (gate.kind === 'no_delivery') return boq.engagementId === null;
  if (gate.kind !== 'home') return false;
  return boq.engagementId === gate.delivery.id || (boq.engagementId === null && gate.delivery.entryPhase === 'execution');
}

/**
 * May a contract be generated from this BOQ? Only when the gate is `home` and
 * the BOQ is that row's, or when the BOQ has no delivery and the pair has none
 * or a light one (old rows only). Null when it may.
 */
export function contractFromBoqRefusal(
  gate: ExecutionGate,
  boq: { engagementId: string | null },
): DesignFirstRefusal | { code: 'boq_not_on_home' } | null {
  return designFirstRefusal(gate) ?? (boqIsOnHome(gate, boq) ? null : { code: 'boq_not_on_home' });
}

const TARGET_CODES: ReadonlySet<string> = new Set(['design_open', 'design_only_closed', 'contract_from_boq_only']);

/** The delivery a refusal sends the studio to, or null for every other answer. */
export function designFirstTargetOf(result: Pick<ActionResult, 'error' | 'params'>): DesignFirstTarget | null {
  if (!result.error || !TARGET_CODES.has(result.error)) return null;
  const { delivery, deliveryId } = result.params ?? {};
  return typeof delivery === 'string' && typeof deliveryId === 'string' ? { delivery, deliveryId } : null;
}
