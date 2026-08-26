// Firm-type registry (Epic B1). CLIENT-SAFE — like flows.ts: a plain constants
// module with NO `server-only` and NO runtime `@metra/db` import, so the
// onboarding wizard (a client component) and the server-side createOrgCore can
// both consume it. A firm type is NOT a stored column: it is a named preset that
// resolves to the workspace's `enabled_flows` set. `interior` is the only
// selectable option today; `construction`/`both` are rendered coming-soon and
// rejected server-side, so the flow strings they reference need not yet exist in
// FLOWS. They're cast to Flow[] here so TS accepts the not-yet-registered strings
// WITHOUT weakening the `Flow` union anywhere else — the server-side validate
// (available + every flow in FLOWS) is what actually keeps them out of the DB.
import type { Flow } from './flows';

export const FIRM_TYPES = [
  { key: 'interior', enabledFlows: ['interior'] as Flow[], available: true },
  {
    key: 'construction',
    // `construction` is not yet in FLOWS — cast through unknown so TS accepts the
    // not-yet-registered string WITHOUT widening the `Flow` union anywhere else.
    // available:false + the server-side FLOWS check keep it out of the DB.
    enabledFlows: ['construction'] as unknown as Flow[],
    available: false,
  },
  {
    key: 'both',
    enabledFlows: ['interior', 'construction'] as unknown as Flow[],
    available: false,
  },
] as const;

export type FirmTypeKey = (typeof FIRM_TYPES)[number]['key'];

/** The registry entry for a firm-type key, or undefined if unknown. */
export function firmTypeDef(
  key: FirmTypeKey,
): (typeof FIRM_TYPES)[number] | undefined {
  return FIRM_TYPES.find((def) => def.key === key);
}

/** The `enabled_flows` set a firm type resolves to (empty for an unknown key). */
export function flowsForFirmType(key: FirmTypeKey): Flow[] {
  const def = firmTypeDef(key);
  return def ? [...def.enabledFlows] : [];
}
