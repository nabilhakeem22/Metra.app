import 'server-only';
import {
  addDays,
  cairoHour,
  dayPeriodKey,
  todayInCairo,
  weekPeriodKey,
} from './clock';
import { claimPeriod } from './claim';
import { deliveryCounts } from './delivery-due-work';
import { digestData, orgOwnerAdminIds, type DigestData } from './due-work';
import { emailEachRecipient } from './email-delivery';
import { sharedInFlightDeliveries } from './org-tick-memo';
import type { AutomationDeps, AutomationResult } from './types';
import type { MetraDb } from '@metra/db';
import { withOrgContext } from '@/lib/db/context';
import { sendDigestEmail } from '@/lib/email/resend';
import { insertNotifications } from '@/lib/notifications/core';

const EXPIRING_SOON_DAYS = 7;

/**
 * The digest's figures: the portfolio's, plus every in-flight delivery by the
 * shared status rule (Round C; read once per org per tick and shared with the
 * delivery follow-ups).
 */
async function portfolioFigures(
  tx: MetraDb,
  deps: AutomationDeps,
  window: { today: string; soon: string },
): Promise<DigestData & { deliveriesYourMove: number; deliveriesWaiting: number; deliveriesStalled: number }> {
  const [portfolio, { deliveries }] = await Promise.all([
    digestData(tx, window.today, window.soon),
    sharedInFlightDeliveries(deps, tx),
  ]);
  const counts = deliveryCounts(deliveries);
  return {
    ...portfolio,
    deliveriesYourMove: counts.yourMove,
    deliveriesWaiting: counts.waitingOnClient,
    deliveriesStalled: counts.stalled,
  };
}

/**
 * Portfolio digest for owners/admins, gated to the 07:00 Cairo send hour and
 * claimed once per cadence period (ISO week for weekly, Cairo day for daily).
 * Aggregate-only figures (the portfolio's, and its deliveries by the shared
 * status rule) — never a client address, never cost/margin. Notifies
 * every owner/admin and best-effort emails each.
 */
export async function runPortfolioDigest(
  deps: AutomationDeps,
): Promise<AutomationResult> {
  const { ctx, settings, now, locale, appUrl } = deps;
  const result: AutomationResult = {
    automation: 'digest',
    ran: false,
    effects: 0,
    emailsSent: 0,
    emailsFailed: 0,
  };
  if (!settings.digestEnabled) return result;
  if (cairoHour(now) !== 7) return result;

  const cadence = settings.digestCadence;
  const period =
    cadence === 'weekly' ? weekPeriodKey(now) : dayPeriodKey(now);
  const today = todayInCairo(now);
  const soon = addDays(today, EXPIRING_SOON_DAYS);

  const won = await withOrgContext(ctx, async (tx) => {
    const claimed = await claimPeriod(
      tx,
      ctx.orgId,
      'digest',
      `${cadence}:${period}`,
    );
    if (!claimed) return null;
    const data = await portfolioFigures(tx, deps, { today, soon });
    const owners = await orgOwnerAdminIds(tx);
    await insertNotifications(
      tx,
      ctx.orgId,
      owners.map((o) => ({
        recipientUserId: o.userId,
        kind: 'portfolio_digest' as const,
        bodyKey: 'portfolio_digest',
        params: { ...data },
      })),
    );
    result.effects += owners.length;
    return { data, owners };
  });
  if (!won) return result;
  result.ran = true;

  await emailEachRecipient(
    deps,
    won.owners.map((o) => o.userId),
    (to) => sendDigestEmail({ to, ...won.data, dashboardUrl: `${appUrl}/${locale}/dashboard`, locale }),
    result,
  );

  return result;
}
