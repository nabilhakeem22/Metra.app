import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEB_ROOT, wranglerConfig } from './wrangler-rate-limits';

// S11 + S0 (go-live security). workers.dev is the production origin until a
// custom domain arrives, so it stays ON, explicitly. Version preview URLs run
// old builds with production secrets, so they are OFF. The Hyperdrive config
// has query caching DISABLED (tenant isolation rides on per-transaction GUCs no
// cache key can see), and the comment above the binding must never claim a cache.

const config = wranglerConfig() as { workers_dev?: unknown; preview_urls?: unknown };
const configText = readFileSync(resolve(WEB_ROOT, 'wrangler.jsonc'), 'utf8');

describe('wrangler.jsonc hostnames', () => {
  it('keeps workers.dev on, explicitly', () => {
    expect(config.workers_dev).toBe(true);
  });

  it('turns version preview URLs off', () => {
    expect(config.preview_urls).toBe(false);
  });
});

describe('the Hyperdrive comment', () => {
  it('never claims an edge cache', () => {
    expect(configText).not.toMatch(/edge cache/i);
  });

  it('says query caching is disabled', () => {
    expect(configText).toMatch(/caching is DISABLED/);
  });
});
