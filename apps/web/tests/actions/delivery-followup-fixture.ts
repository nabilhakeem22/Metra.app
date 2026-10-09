// Shared set-up for the delivery follow-up and digest dbtests (Round C, C4): an
// org with every studio role, deliveries of a chosen age that wait on the client
// or on the studio, and the runner's deps at 07:00 Cairo. Not a test file.
import { expect } from 'vitest';
import type { AutomationSettings } from '@metra/db';
import { cairoHour } from '@/lib/automation/clock';
import { createEmailBreaker } from '@/lib/automation/email-breaker';
import { createOrgTickMemo } from '@/lib/automation/org-tick-memo';
import { resolveSystemContext } from '@/lib/automation/system-context';
import type { AutomationDeps } from '@/lib/automation/types';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import type { OrgContext } from '@/lib/db/context';
import { createEngagementCore } from '@/lib/engagements/core';
import { executeTransition } from '@/lib/engagements/executor';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { ctxFor, raw, seedOrg } from './fixture';

const DAY_MS = 86_400_000;

export interface FollowupOrg {
  orgId: string;
  ctx: OrgContext;
  clientId: string;
  /** The owner and the admin: the only roles a follow-up may reach. */
  ownerAdminIds: string[];
  /** Project manager, site engineer, accountant, viewer. */
  otherMemberIds: string[];
}

export async function followupOrg(orgIds: string[]): Promise<FollowupOrg> {
  const { orgId, ownerIds, memberIds } = await seedOrg({
    owners: 1,
    members: [
      { role: 'admin' },
      { role: 'project_manager' },
      { role: 'site_engineer' },
      { role: 'accountant' },
      { role: 'viewer' },
    ],
  });
  orgIds.push(orgId);
  const ctx = ctxFor(orgId, ownerIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  return { orgId, ctx, clientId: client.id, ownerAdminIds: [ownerIds[0], memberIds[0]], otherMemberIds: memberIds.slice(1) };
}

/**
 * 07:00 in Cairo on 2026-10-14 (a Wednesday) plus `days`, found by the app's own
 * clock on that very day, so a daylight-saving change in between cannot shift it.
 */
export function sevenAmCairo(days = 0): Date {
  let at = Date.UTC(2026, 9, 14 + days, 0, 0, 0);
  while (cairoHour(new Date(at)) !== 7) at += 3_600_000;
  return new Date(at);
}

/**
 * One delivery on its own project, created, moved and last changed `ageDays`
 * (and an hour) before `asOf`: waiting on the client (fee set, deposit unpaid)
 * or the studio's move (just created). Its wait therefore began then too.
 */
export async function deliveryAged(
  org: FollowupOrg,
  code: string,
  ageDays: number,
  asOf: Date,
  holder: 'client' | 'studio' = 'client',
): Promise<string> {
  const project = { startDate: '2026-01-01', endDate: '2026-12-31', code, nameEn: code, clientId: org.clientId };
  expect((await createProjectCore(org.ctx, { ...project, status: 'active' })).ok).toBe(true);
  const projectId = (await listProjects(org.ctx, {})).find((row) => row.code === code)!.id;
  const created = await createEngagementCore(org.ctx, { titleEn: `Delivery ${code}`, clientId: org.clientId, projectId });
  const engagementId = (created as { data?: string }).data!;
  if (holder === 'client') {
    const fee = await executeTransition(org.ctx, {
      engagementId,
      trigger: 'submitDesignFee',
      payload: {
        designFee: '100000',
        milestones: [
          { kind: 'deposit', basis: 'amount', value: '30000' },
          { kind: 'gate_a', basis: 'amount', value: '20000' },
          { kind: 'gate_b', basis: 'amount', value: '25000' },
          { kind: 'balance', basis: 'amount', value: '25000' },
        ],
      },
    });
    expect(fee.ok).toBe(true);
  }
  const changedAt = new Date(asOf.getTime() - ageDays * DAY_MS - 3_600_000).toISOString();
  await raw.query(
    `update public.design_engagements set created_at = '${changedAt}', updated_at = '${changedAt}' where id = '${engagementId}'`,
  );
  await raw.query(`update public.engagement_transitions set decided_at = '${changedAt}' where engagement_id = '${engagementId}'`);
  return engagementId;
}

/** The runner's deps for this org at `now`; every member has an address. */
export async function depsAt(org: FollowupOrg, now: Date, settings: Partial<AutomationSettings>): Promise<AutomationDeps> {
  return {
    ctx: (await resolveSystemContext(org.orgId))!,
    settings: { followupEnabled: true, followupThresholdDays: 5, ...settings } as AutomationSettings,
    now,
    locale: 'en',
    appUrl: 'https://metra.test',
    lookupRecipientEmail: async (userId) => ({ status: 'found', email: `${userId}@studio.test` }),
    emailBreaker: createEmailBreaker(),
    memo: createOrgTickMemo(),
  };
}

/** The `delivery_followup` notifications of this org: who got one, about what, with what params. */
export async function followupNotifications(orgId: string) {
  return raw.query<{ recipient_user_id: string; entity_id: string; params: { days: number; number: number; year: number } }>(
    `select recipient_user_id, entity_id, params from public.notifications
      where org_id = '${orgId}' and kind = 'delivery_followup' order by created_at`,
  );
}
