// Automation cron trigger. Cloudflare fires `scheduled` hourly (see the crons
// trigger in wrangler.jsonc) and this worker pings the Next.js automation route
// with the shared bearer secret. All automation work + auth live in the route
// (apps/web/src/app/api/cron/automations); this worker is a thin scheduler.

interface Env {
  /** Origin of the deployed Next.js app, no trailing slash (a `vars` value). */
  APP_ORIGIN: string;
  /** Shared bearer secret; must match the app's CRON_SECRET (a Worker secret). */
  CRON_SECRET: string;
}

export default {
  async scheduled(
    _event: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const url = `${env.APP_ORIGIN}/api/cron/automations`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
    });
    // A wrong/absent bearer makes the route answer 401 and a bad tick 500.
    // Throwing marks the scheduled invocation as FAILED, which is what puts it
    // on the worker's error rate / Cron Triggers dashboard — a console.log of
    // "401" is invisible unless someone happens to be tailing.
    if (!response.ok) {
      throw new Error(`automation cron ${response.status} from ${url}`);
    }
    console.log(`automation cron -> ${url} : ${response.status}`);
  },
} satisfies ExportedHandler<Env>;
