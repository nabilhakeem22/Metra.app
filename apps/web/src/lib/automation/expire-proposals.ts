import 'server-only';
import { addDays, todayInCairo } from './clock';
import { claimPeriod } from './claim';
import { dueForExpiry, dueForExpiryNudge } from './due-work';
import type { AutomationDeps, AutomationResult } from './types';
import { withOrgContext } from '@/lib/db/context';
import { insertNotification } from '@/lib/notifications/core';
import { expireProposalCore } from '@/lib/proposals/core';

/**
 * Flip `sent` proposals whose expiry date is strictly before today (Cairo) to
 * `expired`, reusing `expireProposalCore`'s own atomic status gate. Optionally
 * (expireNudgeEnabled) notify the sender N days BEFORE expiry. Notification-only:
 * NEVER emails a client. The daily flip is period-claimed once per Cairo day; the
 * pre-expiry nudge is claimed once per proposal.
 */
export async function runExpireProposals(
  deps: AutomationDeps,
): Promise<AutomationResult> {
  const { ctx, settings, now } = deps;
  const result: AutomationResult = {
    automation: 'expire',
    ran: false,
    effects: 0,
    emailsSent: 0,
    emailsFailed: 0,
  };
  if (!settings.expireEnabled) return result;

  const today = todayInCairo(now);

  const claimed = await withOrgContext(ctx, (tx) =>
    claimPeriod(tx, ctx.orgId, 'expire', today),
  );
  result.ran = claimed;

  if (claimed) {
    const candidates = await withOrgContext(ctx, (tx) => dueForExpiry(tx, today));
    for (const c of candidates) {
      // Each core is its own atomic tx; its WHERE status='sent' is the real gate.
      const res = await expireProposalCore(ctx, { id: c.id });
      if (res.ok) result.effects += 1;
    }
  }

  // Pre-expiry nudge — independent of the daily flip claim, once per proposal.
  if (settings.expireNudgeEnabled) {
    const targetDate = addDays(today, settings.expireNudgeLeadDays);
    const nudges = await withOrgContext(ctx, (tx) =>
      dueForExpiryNudge(tx, targetDate),
    );
    for (const n of nudges) {
      await withOrgContext(ctx, async (tx) => {
        const won = await claimPeriod(tx, ctx.orgId, 'expire_nudge', n.id);
        if (!won) return;
        await insertNotification(tx, ctx.orgId, {
          recipientUserId: n.senderUserId ?? ctx.userId,
          kind: 'expire_nudge',
          entityType: 'proposal',
          entityId: n.id,
          bodyKey: 'proposal_expiring',
          params: { number: n.number, expiryDate: n.expiryDate },
        });
        result.effects += 1;
      });
    }
  }

  return result;
}
