import 'server-only';
// What one org's cores share on one tick (Round C, R1): the in-flight deliveries
// are read ONCE per org per tick, by whichever core needs them first (the digest
// or the delivery follow-ups, both at 07:00 Cairo), as of the tick's instant.
import type { MetraDb } from '@metra/db';
import { inFlightDeliveries, type InFlightDelivery } from './delivery-due-work';
import type { AutomationDeps } from './types';

export type InFlightRead = { deliveries: InFlightDelivery[]; capped: boolean };

/** Created by the runner for each org on each tick; cores read it through the helpers below. */
export interface OrgTickMemo {
  inFlight?: Promise<InFlightRead>;
  /** May the lost-notification sweep have work? (./lost-act-probe.ts) */
  lostActsPossible?: Promise<boolean>;
}

export function createOrgTickMemo(): OrgTickMemo {
  return {};
}

/**
 * The org's in-flight deliveries as of `deps.now`, read inside `tx` the first
 * time and shared afterwards. A failed read is forgotten, so the next core
 * reads again rather than inheriting the failure.
 */
export function sharedInFlightDeliveries(deps: Pick<AutomationDeps, 'ctx' | 'now' | 'memo'>, tx: MetraDb): Promise<InFlightRead> {
  if (!deps.memo.inFlight) {
    const read = inFlightDeliveries(tx, deps.ctx.role, deps.now);
    deps.memo.inFlight = read;
    read.catch(() => {
      if (deps.memo.inFlight === read) delete deps.memo.inFlight;
    });
  }
  return deps.memo.inFlight;
}
