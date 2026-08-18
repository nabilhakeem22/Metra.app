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
    // A wrong/absent bearer makes the route answer 401; surface the status so a
    // misconfigured secret is visible in the worker's tail logs.
    console.log(`automation cron -> ${url} : ${response.status}`);
  },
} satisfies ExportedHandler<Env>;
