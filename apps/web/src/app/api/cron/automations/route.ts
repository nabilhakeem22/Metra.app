import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runDueAutomations } from '@/lib/automation/runner';

// Session-less cron. Node-only (crypto + privileged DB); the i18n matcher skips
// /api. Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}` on each tick.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Constant-time bearer check against CRON_SECRET. False if secret unset. */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
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
