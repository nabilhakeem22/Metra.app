import { afterAll, describe, expect, it } from 'vitest';
import { runExpireProposals } from '@/lib/automation/expire-proposals';
import { runFollowupReminders } from '@/lib/automation/followup-reminders';
import { runPortfolioDigest } from '@/lib/automation/portfolio-digest';
import { runStageReminders } from '@/lib/automation/stage-reminders';
import { cairoHour } from '@/lib/automation/clock';
import { claimPeriod } from '@/lib/automation/claim';
import { resolveSystemContext } from '@/lib/automation/system-context';
import { getAutomationSettings } from '@/lib/automation/settings-queries';
import type { AutomationDeps } from '@/lib/automation/types';
import { createClientCore } from '@/lib/clients/core';
import { listClients } from '@/lib/clients/queries';
import { withOrgContext, type OrgContext } from '@/lib/db/context';
import {
  countUnread,
  listNotifications,
} from '@/lib/notifications/queries';
import {
  insertNotification,
  markAllNotificationsReadCore,
} from '@/lib/notifications/core';
import { createProjectCore } from '@/lib/projects/core';
import { listProjects } from '@/lib/projects/queries';
import { createProposalCore, sendProposalCore } from '@/lib/proposals/core';
import { closeFixture, ctxFor, raw, seedOrg, teardown } from './fixture';
import type { MemberRole } from '@metra/db';

const orgIds: string[] = [];
afterAll(async () => {
  await teardown(orgIds);
  await closeFixture();
});

async function setup(opts: { owners?: number; members?: Array<{ role: MemberRole }> } = {}) {
  const seeded = await seedOrg({ owners: opts.owners ?? 1, members: opts.members ?? [] });
  orgIds.push(seeded.orgId);
  const ctx = ctxFor(seeded.orgId, seeded.ownerIds[0] ?? seeded.memberIds[0], 'owner');
  await createClientCore(ctx, { phone: '01000000000', nameEn: 'Acme' });
  const [client] = await listClients(ctx, {});
  await createProjectCore(ctx, {
    code: 'PRJ-1',
    nameEn: 'Tower',
    clientId: client.id,
    status: 'active',
  });
  const [project] = await listProjects(ctx, {});
  return { ...seeded, ctx, clientId: client.id, projectId: project.id };
}

async function newestProposalId(orgId: string): Promise<string> {
  const rows = await raw.query<{ id: string }>(
    `select id from public.proposals where org_id='${orgId}' order by number desc limit 1`,
  );
  return rows[0].id;
}

async function makeSentProposal(args: {
  buildCtx: OrgContext;
  sendCtx: OrgContext;
  clientId: string;
  projectId: string;
  expiryDate?: string | null;
}): Promise<string> {
  await createProposalCore(args.buildCtx, {
    clientId: args.clientId,
    projectId: args.projectId,
    expiryDate: args.expiryDate ?? null,
  });
  const id = await newestProposalId(args.buildCtx.orgId);
  const sent = await sendProposalCore(args.sendCtx, { id });
  expect(sent.ok).toBe(true);
  return id;
}

async function statusOf(id: string): Promise<string> {
  const rows = await raw.query<{ status: string }>(
    `select status from public.proposals where id='${id}'`,
  );
  return rows[0].status;
}

async function depsFor(ctx: OrgContext, now: Date): Promise<AutomationDeps> {
  const settings = await getAutomationSettings(ctx);
  if (!settings) throw new Error('missing automation settings');
  return { ctx, settings, now, locale: 'en', appUrl: '' };
}

/** A UTC instant whose Cairo wall-clock hour is 7 (DST-safe scan). */
function atCairoHour(dateUtc: string, target: number): Date {
  for (let h = 0; h < 24; h += 1) {
    const d = new Date(`${dateUtc}T${String(h).padStart(2, '0')}:30:00Z`);
    if (cairoHour(d) === target) return d;
  }
  throw new Error(`no UTC hour maps to Cairo ${target}`);
}

describe('resolveSystemContext', () => {
  it('picks the earliest owner and acts as owner', async () => {
    const { orgId, ownerIds } = await setup({ owners: 2 });
    const ctx = await resolveSystemContext(orgId);
    expect(ctx).not.toBeNull();
    expect(ctx?.userId).toBe(ownerIds[0]);
    expect(ctx?.role).toBe('owner');
  });

  it('falls back to an admin when there is no owner', async () => {
    const { orgId, memberIds } = await setup({ owners: 0, members: [{ role: 'admin' }] });
    const ctx = await resolveSystemContext(orgId);
    expect(ctx?.userId).toBe(memberIds[0]);
    expect(ctx?.role).toBe('admin');
  });

  it('returns null when the org has no owner or admin', async () => {
    const { orgId } = await setup({ owners: 0, members: [{ role: 'viewer' }] });
    expect(await resolveSystemContext(orgId)).toBeNull();
  });
});

describe('expire proposals core — isolation + idempotency', () => {
  it('flips only sent-past-expiry, never crosses tenants, and claims once', async () => {
    const a = await setup();
    const b = await setup();
    const pA = await makeSentProposal({
      buildCtx: a.ctx,
      sendCtx: a.ctx,
      clientId: a.clientId,
      projectId: a.projectId,
      expiryDate: '2000-01-01',
    });
    const pB = await makeSentProposal({
      buildCtx: b.ctx,
      sendCtx: b.ctx,
      clientId: b.clientId,
      projectId: b.projectId,
      expiryDate: '2000-01-01',
    });

    const now = new Date();
    const ctxA = (await resolveSystemContext(a.orgId))!;
    const res = await runExpireProposals(await depsFor(ctxA, now));

    expect(res.ran).toBe(true);
    expect(res.effects).toBe(1);
    // Org A's proposal expired; org B's is untouched (RLS isolation).
    expect(await statusOf(pA)).toBe('expired');
    expect(await statusOf(pB)).toBe('sent');
    // The run wrote its claim only in org A.
    expect(await raw.count('automation_run_log', a.orgId)).toBe(1);
    expect(await raw.count('automation_run_log', b.orgId)).toBe(0);

    // Re-run same Cairo day: the daily claim is taken -> no work.
    const res2 = await runExpireProposals(await depsFor(ctxA, now));
    expect(res2.ran).toBe(false);
    expect(res2.effects).toBe(0);
  });
});

describe('follow-up reminders core — targets the sender, not the client', () => {
  it('notifies the actual sender (not the system actor, never a client)', async () => {
    const { orgId, ownerIds, clientId, projectId } = await setup({ owners: 2 });
    const systemActor = ownerIds[0];
    const sender = ownerIds[1];

    const pid = await makeSentProposal({
      buildCtx: ctxFor(orgId, systemActor, 'owner'),
      sendCtx: ctxFor(orgId, sender, 'owner'),
      clientId,
      projectId,
    });
    // Backdate the 'sent' event so the proposal is well past the 5-day threshold.
    await raw.query(
      `update public.proposal_events set created_at = now() - interval '12 days'
       where proposal_id='${pid}' and kind='sent'`,
    );

    const ctx = (await resolveSystemContext(orgId))!;
    expect(ctx.userId).toBe(systemActor);
    const res = await runFollowupReminders(await depsFor(ctx, new Date()));
    expect(res.ran).toBe(true);
    expect(res.effects).toBe(1);

    const rows = await raw.query<{ recipient_user_id: string; kind: string }>(
      `select recipient_user_id, kind from public.notifications where org_id='${orgId}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('followup_reminder');
    // The recipient is the SENDER, not the system actor — and always an internal
    // user id (never a client).
    expect(rows[0].recipient_user_id).toBe(sender);
    expect(rows[0].recipient_user_id).not.toBe(systemActor);

    // Same window -> claim held -> no second notification.
    const res2 = await runFollowupReminders(await depsFor(ctx, new Date()));
    expect(res2.effects).toBe(0);
  });
});

describe('claimPeriod — atomic single-winner', () => {
  it('two concurrent claims on the same key yield exactly one winner', async () => {
    const { orgId } = await setup();
    const ctx = (await resolveSystemContext(orgId))!;
    const [a, b] = await Promise.all([
      withOrgContext(ctx, (tx) => claimPeriod(tx, orgId, 'race', 'k1')),
      withOrgContext(ctx, (tx) => claimPeriod(tx, orgId, 'race', 'k1')),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});

describe('notifications are recipient-scoped', () => {
  it('each user sees and clears only their own rows', async () => {
    const { orgId, ownerIds, memberIds } = await setup({
      members: [{ role: 'viewer' }],
    });
    const owner = ownerIds[0];
    const member = memberIds[0];
    const actor = (await resolveSystemContext(orgId))!;

    await withOrgContext(actor, async (tx) => {
      await insertNotification(tx, orgId, {
        recipientUserId: owner,
        kind: 'stage_reminder',
        bodyKey: 'stage_reminder',
        params: { overdueCount: 1, upcomingCount: 0 },
      });
      await insertNotification(tx, orgId, {
        recipientUserId: member,
        kind: 'stage_reminder',
        bodyKey: 'stage_reminder',
        params: { overdueCount: 1, upcomingCount: 0 },
      });
    });

    const ownerCtx = ctxFor(orgId, owner, 'owner');
    const memberCtx = ctxFor(orgId, member, 'viewer');

    expect(await listNotifications(ownerCtx, {})).toHaveLength(1);
    expect(await listNotifications(memberCtx, {})).toHaveLength(1);

    // The member clears their own; the owner's stays unread.
    await markAllNotificationsReadCore(memberCtx);
    expect(await countUnread(memberCtx)).toBe(0);
    expect(await countUnread(ownerCtx)).toBe(1);
  });
});

describe('portfolio digest core — 07:00 Cairo gate + once-per-period', () => {
  it('does nothing outside the send hour', async () => {
    const { orgId } = await setup();
    const ctx = (await resolveSystemContext(orgId))!;
    const offHour = atCairoHour('2026-03-10', 9);
    const res = await runPortfolioDigest(await depsFor(ctx, offHour));
    expect(res.ran).toBe(false);
    expect(res.effects).toBe(0);
  });

  it('notifies owners at 07:00 Cairo and claims the period', async () => {
    const { orgId, ownerIds } = await setup();
    const ctx = (await resolveSystemContext(orgId))!;
    const sendHour = atCairoHour('2026-03-10', 7);

    const res = await runPortfolioDigest(await depsFor(ctx, sendHour));
    expect(res.ran).toBe(true);
    expect(res.effects).toBe(ownerIds.length);

    const rows = await raw.query<{ recipient_user_id: string; kind: string }>(
      `select recipient_user_id, kind from public.notifications where org_id='${orgId}' and kind='portfolio_digest'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient_user_id).toBe(ownerIds[0]);

    // Same week -> claimed -> no-op.
    const res2 = await runPortfolioDigest(await depsFor(ctx, sendHour));
    expect(res2.ran).toBe(false);
  });
});

describe('stage reminders core — 07:00 Cairo gate', () => {
  it('is gated to the send hour', async () => {
    const { orgId } = await setup();
    const ctx = (await resolveSystemContext(orgId))!;
    const offHour = atCairoHour('2026-03-11', 12);
    const res = await runStageReminders(await depsFor(ctx, offHour));
    expect(res.ran).toBe(false);
    expect(res.effects).toBe(0);
  });
});
