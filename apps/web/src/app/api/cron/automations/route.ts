import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runDueAutomations } from '@/lib/automation/runner';
import { runtimeSecret } from '@/lib/cf/secrets';

// Session-less cron. Node-only (crypto + privileged DB); the i18n matcher skips
// /api. The `metra-cron` Cloudflare Worker (workers/cron) is the only caller and
// sends `Authorization: Bearer ${CRON_SECRET}` on each tick.
// Schedule is HOURLY (workers/cron/wrangler.jsonc) by design, not for
// granularity: the digest
// and stage automations gate on `cairoHour === 7`, and only an hourly tick hits
// that wall-clock hour reliably across Egypt's DST shift (UTC+2 <-> UTC+3). A
// daily UTC cron would drift off 07:00 Cairo for half the year. Each automation
// still claims its own period, so extra ticks are no-ops, not duplicates.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Constant-time bearer check against CRON_SECRET. False if the secret is unset —
 * an unconfigured cron is UNAUTHORISED, never open.
 *
 * Read through runtimeSecret() like every other Worker secret. `process.env`
 * would in fact work here (populateProcessEnv copies the Worker's secrets into
 * it per request), but it is the one form a bundler can fold into a literal if a
 * `.env` file is ever present at build time, and it is the form the deploy
 * runbook says this codebase does not use.
 */
function authorized(req: Request): boolean {
  const secret = runtimeSecret('CRON_SECRET');
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return false;
  const provided = Buffer.from(header.slice(prefix.length));
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await runDueAutomations();
    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    // The runner is designed never to throw; this is the last-resort net so a
    // single bad tick returns 500 rather than crashing the function.
    console.error('automation cron failed:', err);
    return NextResponse.json({ error: 'Automation run failed' }, { status: 500 });
  }
}
