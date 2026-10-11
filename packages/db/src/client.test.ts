import { describe, expect, it } from 'vitest';
import { createDb } from './client';

// Round D: the client page echoes an issuance instant (rom.issued_at,
// renders_issued_at) back to app_delivery_respond_by_token as TEXT cast with
// ::timestamptz, and the database compares it to the microsecond. postgres.js
// on its own serializes a timestamptz parameter through a JS Date
// (milliseconds), which turned every guarded act into wrong_state in the D2
// rehearsal. The app's handle is drizzle's, which passes those parameters
// through untouched; this pins that, so a driver upgrade that drops it fails
// here and not in production. No socket is opened (postgres.js connects lazily).

describe('createDb', () => {
  it('passes timestamp parameters through as the exact text, microseconds included', async () => {
    const { sql } = createDb('postgres://user:pw@127.0.0.1:1/none', { max: 1 });
    const stamp = '2026-10-10T10:00:00.123456+03:00';
    for (const oid of [1184, 1114]) {
      expect(sql.options.serializers[oid]!(stamp)).toBe(stamp);
    }
    await sql.end({ timeout: 0 });
  });
});
