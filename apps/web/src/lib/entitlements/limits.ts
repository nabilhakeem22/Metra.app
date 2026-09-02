// Workspace numeric limits — PURE and CLIENT-SAFE: no db import, no `server-only`,
// no 'use client'. Split from ./entitlements.ts (which is server-only) so the rule
// can be unit-tested. That is the THIRD time this session a pure function had to be
// lifted out of a server-only module to become testable; the pattern is the point,
// not the individual fix.
import type { WorkspaceEntitlements } from './entitlements';

/** The limit key governing how many projects a workspace may hold. */
export const PROJECT_LIMIT_KEY = 'projects';

/**
 * Is a workspace allowed to create one more of `key`, given how many it already has?
 *
 * UNSET MEANS UNLIMITED, deliberately and load-bearingly. No org in production has
 * any limit configured (the column defaults to `{}` and nothing writes it yet), so
 * treating an absent limit as zero would lock all 302 workspaces out of creating
 * anything the moment this shipped. The cap starts biting only when a plan actually
 * sets a number.
 *
 * A limit of 0 is therefore a REAL zero — an explicitly disabled capability — while
 * a missing key is "no opinion". A negative or non-finite value is treated as
 * unset rather than trusted, since it can only be bad configuration.
 */
export function withinLimit(
  ent: WorkspaceEntitlements,
  key: string,
  currentCount: number,
): boolean {
  const limit = ent.limits[key];
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit < 0) return true;
  return currentCount < limit;
}
