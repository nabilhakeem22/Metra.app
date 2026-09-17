import type { Trigger } from '@/lib/engagements/transitions';

/**
 * The held idempotency keys, MIRRORED to sessionStorage (wave-2 A9).
 *
 * Wave 2 logged the gap as a real risk and scheduled it for wave 4, which did not
 * do it: a key held for an attempt in doubt lives in a `useRef`, so a remount —
 * a soft navigation away and back, a Fast Refresh, a router.refresh() that
 * replaces the tree — loses it, and the studio's retry mints a FRESH key. A fresh
 * key is a fresh act: one duplicate revision, or one duplicate attestation.
 *
 * sessionStorage, not localStorage: the keys must die with the tab. A key that
 * outlived the browser session would attach a week-old identity to a new attempt,
 * which is a worse failure than the one this fixes. The entry is namespaced per
 * engagement and removed the moment the map empties.
 *
 * EVERY call is wrapped: Safari private mode throws on `sessionStorage` ACCESS,
 * not just on write, and a cockpit that will not render because storage is
 * unavailable is a far larger defect than the one being closed. On any throw the
 * hook behaves exactly as it did before this module existed.
 */

export function heldKeysStorageKey(engagementId: string): string {
  return `metra.pendingKeys.${engagementId}`;
}

/** Read the keys this tab was holding for this engagement, or an empty map. */
export function readHeldKeys(engagementId: string): Map<Trigger, string> {
  try {
    const raw = globalThis.sessionStorage?.getItem(heldKeysStorageKey(engagementId));
    if (!raw) return new Map();
    const stored = JSON.parse(raw) as Record<string, string>;
    // Entries are read back UNVALIDATED against the Trigger union on purpose: an
    // entry written by an older build naming a trigger this one has dropped is
    // simply a key nobody will ever ask for, and it is removed when the map next
    // empties. Refusing to parse the whole record because of one stale name would
    // throw away the keys that still matter.
    return new Map(Object.entries(stored) as [Trigger, string][]);
  } catch {
    return new Map();
  }
}

/** Mirror the map, or REMOVE the entry once nothing is held. */
export function writeHeldKeys(engagementId: string, held: Map<Trigger, string>): void {
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    const name = heldKeysStorageKey(engagementId);
    if (held.size === 0) storage.removeItem(name);
    else storage.setItem(name, JSON.stringify(Object.fromEntries(held)));
  } catch {
    // Storage refused. The in-memory map is still authoritative for this mount,
    // so the only thing lost is the ability to survive a remount.
  }
}
