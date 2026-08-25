import 'server-only';
import { workspaceEntitlements, type MetraDb } from '@metra/db';
import { eq } from 'drizzle-orm';
import type { Flow } from './flows';

/**
 * The resolved per-workspace entitlements (Epic A2): which guided flows are
 * enabled, plus numeric limits and boolean feature switches. Shape mirrors the
 * `workspace_entitlements` row's jsonb columns, narrowed for callers.
 */
export interface WorkspaceEntitlements {
  enabledFlows: Flow[];
  limits: Record<string, number>;
  features: Record<string, boolean>;
}

/**
 * Load the workspace's entitlement row inside an existing RLS-scoped tx. FAILS
 * CLOSED: a missing row (workspace never provisioned, or the row RLS-hidden)
 * resolves to zero flows / empty limits / empty features, so `canUseFlow` denies
 * everything rather than silently permitting it.
 */
export async function loadWorkspaceEntitlements(
  tx: MetraDb,
  orgId: string,
): Promise<WorkspaceEntitlements> {
  const [row] = await tx
    .select({
      enabledFlows: workspaceEntitlements.enabledFlows,
      limits: workspaceEntitlements.limits,
      features: workspaceEntitlements.features,
    })
    .from(workspaceEntitlements)
    .where(eq(workspaceEntitlements.orgId, orgId))
    .limit(1);

  if (!row) {
    // Fail closed, but make a VANISHED row diagnosable vs. an intentional plan
    // gate: every provisioned workspace gets an entitlements row at bootstrap, so
    // a missing one is an anomaly worth surfacing in the server logs. The returned
    // value stays fail-closed empty (deny everything) regardless.
    console.error(`entitlements_row_missing orgId=${orgId}`);
    return { enabledFlows: [], limits: {}, features: {} };
  }

  return {
    enabledFlows: (row.enabledFlows ?? []) as Flow[],
    limits: (row.limits ?? {}) as Record<string, number>,
    features: (row.features ?? {}) as Record<string, boolean>,
  };
}

/** True iff the workspace's plan turns the given guided flow on. */
export function canUseFlow(ent: WorkspaceEntitlements, flow: Flow): boolean {
  return ent.enabledFlows.includes(flow);
}
