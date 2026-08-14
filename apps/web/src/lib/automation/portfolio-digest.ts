import 'server-only';
import {
  addDays,
  cairoHour,
  dayPeriodKey,
  todayInCairo,
  weekPeriodKey,
} from './clock';
import { claimPeriod } from './claim';
import { digestData, orgOwnerAdminIds } from './due-work';
import { resolveUserEmail } from './recipients';
import type { AutomationDeps, AutomationResult } from './types';
import { withOrgContext } from '@/lib/db/context';
import { sendDigestEmail } from '@/lib/email/resend';
import { insertNotification } from '@/lib/notifications/core';

const EXPIRING_SOON_DAYS = 7;

/**
 * Portfolio digest for owners/admins, gated to the 07:00 Cairo send hour and
 * claimed once per cadence period (ISO week for weekly, Cairo day for daily).
 * Aggregate-only figures — never a client address, never cost/margin. Notifies
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
    const data = await digestData(tx, today, soon);
    const owners = await orgOwnerAdminIds(tx);
    for (const o of owners) {
      await insertNotification(tx, ctx.orgId, {
        recipientUserId: o.userId,
        kind: 'portfolio_digest',
        bodyKey: 'portfolio_digest',
        params: { ...data },
      });
      result.effects += 1;
    }
    return { data, owners };
  });
  if (!won) return result;
  result.ran = true;

  for (const o of won.owners) {
    const email = await resolveUserEmail(o.userId);
    if (!email) continue;
    const { sent } = await sendDigestEmail({
      to: email,
      ...won.data,
      dashboardUrl: `${appUrl}/${locale}/dashboard`,
      locale,
    });
    if (sent) result.emailsSent += 1;
    else result.emailsFailed += 1;
  }

  return result;
}
