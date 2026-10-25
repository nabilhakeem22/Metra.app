import { describe, expect, it } from 'vitest';
import { wranglerConfig } from './wrangler-rate-limits';

// Assets-first is load-bearing (CPU relief, Workers Free plan): the landing and
// login pages are pre-rendered HTML in .open-next/assets, served BEFORE the
// Worker runs, and a 404 falls through to the Worker. Each of these settings
// would quietly undo that:
// - run_worker_first: every request runs the Worker again, 10 ms CPU cap and all.
// - not_found_handling "single-page-application": an unknown navigation gets
//   index.html, the "/" locale redirector, instead of the Worker.
// - another html_handling: the /en/login -> en/login.html mapping changes.

interface AssetsConfig { run_worker_first?: unknown; not_found_handling?: unknown; html_handling?: unknown }

const assets = (wranglerConfig() as { assets?: AssetsConfig }).assets;

describe('wrangler.jsonc keeps static assets ahead of the Worker', () => {
  it('declares the assets directory', () => {
    expect(assets).toBeDefined();
  });

  it('never runs the Worker first', () => {
    expect([undefined, false]).toContain(assets?.run_worker_first);
  });

  it('lets a missing asset fall through to the Worker', () => {
    expect([undefined, 'none']).toContain(assets?.not_found_handling);
  });

  it('keeps the default html handling', () => {
    expect([undefined, 'auto-trailing-slash']).toContain(assets?.html_handling);
  });
});
