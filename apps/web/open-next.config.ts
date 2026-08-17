import { defineCloudflareConfig } from '@opennextjs/cloudflare';

// OpenNext-for-Cloudflare adapter config. Spike defaults: no incremental cache
// or queue override yet (those are P1 once the runtime is proven). Keeping this
// minimal is deliberate — the risk we are de-risking is the build + Node runtime,
// not caching strategy.
export default defineCloudflareConfig();
