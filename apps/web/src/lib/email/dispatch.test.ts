// Overlapping sends must all reach the test's Resend mock. Vitest 2 serves a
// mocked module to only one in-flight import per importer; before dispatch
// loaded the SDK once, the second of two overlapping sends got the REAL SDK and
// sent a real request to api.resend.com (CI, resend.test.ts:80).
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/secrets', () => ({
  runtimeSecret: (name: string) => (name === 'RESEND_API_KEY' ? 're-test-key' : 'studio@example.com'),
}));

const send = vi.fn(async () => ({ error: null }));
// A slow factory holds the first load open, so the second send's load starts
// while it is still in flight: the window the CI failure needed by chance.
vi.mock('resend', async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  return { Resend: class { emails = { send }; } };
});

import { dispatchEmail } from './dispatch';

const payload = { to: 'client@example.com', subject: 's', html: '<p>h</p>', text: 't' };

describe('dispatchEmail', () => {
  it('sends overlapping emails through the one mocked SDK load', async () => {
    const results = await Promise.all([
      dispatchEmail(payload, 'first'),
      dispatchEmail(payload, 'second'),
      dispatchEmail(payload, 'third'),
    ]);
    expect(results).toEqual([{ sent: true }, { sent: true }, { sent: true }]);
    expect(send).toHaveBeenCalledTimes(3);
  });
});
