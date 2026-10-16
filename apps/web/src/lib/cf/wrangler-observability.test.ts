import { describe, expect, it } from 'vitest';
import { wranglerConfig } from '@/test/wrangler-rate-limits';

// Workers Logs keep the app's own console lines (all redacted), so a failure
// reference can be looked up after the fact. Invocation logs stay OFF: they
// record request URLs, and a client link carries its token in the path. Traces
// stay OFF (Round E S2): a fetch span records a signed Storage URL in full.

interface Observability {
  enabled?: unknown;
  logs?: { enabled?: unknown; invocation_logs?: unknown };
  traces?: { enabled?: unknown };
}

describe('the Worker observability settings', () => {
  const observability = wranglerConfig().observability as Observability;

  it('keeps the app log lines', () => {
    expect(observability.enabled).toBe(true);
    expect(observability.logs?.enabled).toBe(true);
  });

  it('never records request URLs (client links carry their token)', () => {
    expect(observability.logs?.invocation_logs).toBe(false);
  });

  it('turns traces off explicitly', () => {
    expect(observability.traces).toEqual({ enabled: false });
  });
});
