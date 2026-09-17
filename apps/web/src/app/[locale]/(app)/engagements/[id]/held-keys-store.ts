import {
  HELD_KEY_SLOT_SEPARATOR,
  type HeldKeySlot,
} from '@/lib/engagements/held-act';
import { isHeldKeyLive, type HeldKey } from '@/lib/engagements/held-key';
import { isUuid } from '@/lib/uuid';

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
 * AND EVERY ENTRY CARRIES ITS OWN INSTANT, so the mirror cannot outlive what it
 * describes. A key older than HELD_KEY_TTL_MS is dropped on the way past and
 * erased from storage — see `@/lib/engagements/held-key` for why fifteen minutes.
 *
 * EVERY call is wrapped: Safari private mode throws on `sessionStorage` ACCESS,
 * not just on write, and a cockpit that will not render because storage is
 * unavailable is a far larger defect than the one being closed. On any throw the
 * hook behaves exactly as it did before this module existed.
 */

export function heldKeysStorageKey(engagementId: string): string {
  return `metra.pendingKeys.${engagementId}`;
}

/**
 * One stored entry, or null if it is not one of ours.
 *
 * A bare string is what the FIRST version of this mirror wrote, before a key
 * carried its instant. It is refused rather than adopted with a guessed
 * `heldAt`: a guess would either resurrect a key this rule exists to expire or
 * expire one that is still live, and the cost of refusing is one minted key.
 *
 * THE KEY MUST BE UUID-SHAPED (S1). This value is handed to a server action as
 * the idempotency key, and sessionStorage is writable by devtools or a post-XSS
 * script; the cores refuse a non-uuid with a coded `invalid`, so a poisoned
 * entry would otherwise be replayed and re-persisted on every retry. Refusing it
 * on READ is the half that self-heals.
 */
function readEntry(value: unknown): HeldKey | null {
  if (typeof value !== 'object' || value === null) return null;
  const { key, heldAt } = value as { key?: unknown; heldAt?: unknown };
  if (!isUuid(key)) return null;
  if (typeof heldAt !== 'number' || !Number.isFinite(heldAt)) return null;
  return { key, heldAt };
}

/**
 * A name written by the build that filed ONE ENTRY PER CONTROL carries no
 * separator: its act is inside the value, where nothing now looks for it. Such an
 * entry is DROPPED rather than adopted — adopting it would hand a control's next
 * act a key minted for a different one, which is the defect the slot exists to
 * close, and the cost of dropping it is one minted key.
 */
function isSlotName(name: string): boolean {
  return name.includes(HELD_KEY_SLOT_SEPARATOR);
}

/** Read the keys this tab is still holding for this engagement, or an empty map. */
export function readHeldKeys(
  engagementId: string,
  now: number = Date.now(),
): Map<HeldKeySlot, HeldKey> {
  try {
    const raw = globalThis.sessionStorage?.getItem(heldKeysStorageKey(engagementId));
    if (!raw) return new Map();
    const stored = JSON.parse(raw) as Record<string, unknown>;
    const held = new Map<HeldKeySlot, HeldKey>();
    let discarded = false;
    // SLOT NAMES are read back UNVALIDATED against the Trigger union on purpose:
    // an entry naming a trigger this build has dropped, or an act nobody will
    // submit again, is simply a key nobody will ever ask for. Two things ARE
    // checked: the value (it is what gets sent to the server as the idempotency
    // key), and that the name is a SLOT at all.
    for (const [slot, value] of Object.entries(stored)) {
      const entry = readEntry(value);
      if (entry !== null && isSlotName(slot) && isHeldKeyLive(entry, now)) {
        held.set(slot as HeldKeySlot, entry);
      } else discarded = true;
    }
    // An expired or malformed entry is ERASED here, not left to be re-read and
    // re-discarded on every mount for the life of the tab.
    if (discarded) writeHeldKeys(engagementId, held);
    return held;
  } catch {
    return new Map();
  }
}

/** Mirror the map, or REMOVE the entry once nothing is held. */
export function writeHeldKeys(
  engagementId: string,
  held: ReadonlyMap<HeldKeySlot, HeldKey>,
): void {
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
