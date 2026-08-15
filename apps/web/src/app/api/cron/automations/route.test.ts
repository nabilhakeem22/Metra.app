import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The route's only real logic is the bearer gate; stub the runner so the auth
// test never touches the DB or enumerates orgs.
vi.mock('@/lib/automation/runner', () => ({
  runDueAutomations: vi.fn(async () => ({
    ranAt: '2026-01-01T00:00:00.000Z',
    orgsProcessed: 0,
    results: [],
  })),
}));

import { GET } from './route';

const SECRET = 'cron-secret-123';

function call(auth?: string): Promise<Response> {
  const headers = new Headers();
  if (auth) headers.set('authorization', auth);
  return GET(
    new Request('https://metra.test/api/cron/automations', { headers }),
  );
}

describe('cron automations auth', () => {
  const original = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });
  afterAll(() => {
    process.env.CRON_SECRET = original;
  });

  it('401 when no Authorization header', async () => {
    const res = await call();
    expect(res.status).toBe(401);
  });

  it('401 when the bearer secret is wrong', async () => {
    const res = await call('Bearer not-the-secret');
    expect(res.status).toBe(401);
  });

  it('401 when the secret differs only in length', async () => {
    const res = await call(`Bearer ${SECRET}extra`);
    expect(res.status).toBe(401);
  });

  it('401 when CRON_SECRET is unset (fail closed)', async () => {
    delete process.env.CRON_SECRET;
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(401);
  });

  it('200 + summary with the correct bearer', async () => {
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ orgsProcessed: 0, results: [] });
  });
});
