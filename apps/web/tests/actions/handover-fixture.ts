// Shared helpers for the handover-close dbtests (Round C, C3). Not a test file.
import { expect } from 'vitest';
import type { AutomationSettings } from '@metra/db';
import { createEmailBreaker } from '@/lib/automation/email-breaker';
import { createOrgTickMemo } from '@/lib/automation/org-tick-memo';
import { resolveSystemContext } from '@/lib/automation/system-context';
import type { AutomationDeps } from '@/lib/automation/types';
import { createProjectCore } from '@/lib/projects/core';
import { rawEngagement, type BoqOrg } from './boq-proposal-fixture';
import { raw } from './fixture';

export async function stateOf(engagementId: string): Promise<string> {
  const [row] = await raw.query<{ state: string }>(
    `select state from public.design_engagements where id = '${engagementId}'`,
  );
  return row.state;
}

export async function closeRows(engagementId: string) {
  return raw.query<{ actor_user_id: string | null }>(
    `select actor_user_id from public.engagement_transitions
      where engagement_id = '${engagementId}' and trigger = 'recipientAcknowledges'`,
  );
}

/** A bare engagement in `state` on a project of its own (one active delivery per project). */
export async function engagementOnOwnProject(org: BoqOrg, state: string): Promise<string> {
  const code = `HO-${Math.random().toString(36).slice(2, 8)}`;
  const project = { startDate: '2026-01-01', endDate: '2026-06-30', code, nameEn: code, clientId: org.clientId };
  expect((await createProjectCore(org.ctx, { ...project, status: 'active' })).ok).toBe(true);
  const [row] = await raw.query<{ id: string }>(
    `select id from public.projects where org_id = '${org.orgId}' and code = '${code}'`,
  );
  return rawEngagement({ ...org, projectId: row.id }, state);
}

/** A client-channel handover acknowledgement `minutesAgo` old, as the token path writes it. */
export async function clientAck(org: BoqOrg, engagementId: string, minutesAgo: number): Promise<string> {
  const [row] = await raw.query<{ id: string }>(
    `insert into public.engagement_events (org_id, engagement_id, kind, actor_channel, actor_name, decided_at)
     values ('${org.orgId}', '${engagementId}', 'handoff_acknowledgement', 'client', 'Mona',
             now() - interval '${minutesAgo} minutes') returning id`,
  );
  return row.id;
}

/** A staff-recorded handover acknowledgement `minutesAgo` old, as recordHandoffAcknowledgementCore writes it. */
export async function staffAck(org: BoqOrg, engagementId: string, userId: string, minutesAgo: number): Promise<string> {
  const [row] = await raw.query<{ id: string }>(
    `insert into public.engagement_events (org_id, engagement_id, kind, actor_channel, actor_user_id, decided_at)
     values ('${org.orgId}', '${engagementId}', 'handoff_acknowledgement', 'staff', '${userId}',
             now() - interval '${minutesAgo} minutes') returning id`,
  );
  return row.id;
}

/** The runner's deps for the hourly closer, as the system actor, at `now`. */
export async function closerDeps(orgId: string, now = new Date()): Promise<AutomationDeps> {
  return {
    ctx: (await resolveSystemContext(orgId))!,
    settings: {} as AutomationSettings,
    now,
    locale: 'en',
    appUrl: 'https://metra.test',
    lookupRecipientEmail: async () => ({ status: 'no-address' as const }),
    emailBreaker: createEmailBreaker(),
    memo: createOrgTickMemo(),
  };
}

/** The close's audit row for this delivery. */
export async function closeAudit(engagementId: string) {
  const [row] = await raw.query<{ actor_user_id: string; after: Record<string, string> }>(
    `select actor_user_id, after from public.audit_log
      where entity = 'design_engagement' and entity_id = '${engagementId}' and after ->> 'cause' = 'handoverAcknowledged'`,
  );
  return row;
}
