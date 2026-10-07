// emailClientActRecipients: one lookup and one send per new recipient, every
// lookup bounded by AUTH_LOOKUP_TIMEOUT_MS, and a log line with COUNTS only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getUserById = vi.fn<(id: string) => Promise<unknown>>();
vi.mock('@/lib/supabase/admin', () => ({
  createSupabaseAdminClient: () => ({ auth: { admin: { getUserById } } }),
}));

const sendClientActEmail = vi.fn<(input: { to: string }) => Promise<{ sent: boolean }>>();
vi.mock('@/lib/email/delivery-senders', () => ({
  sendClientActEmail: (input: { to: string }) => sendClientActEmail(input),
}));

import { AUTH_LOOKUP_TIMEOUT_MS } from '@/lib/http/deadlines';
import { CLIENT_ACT_EMAIL_CONCURRENCY, emailClientActRecipients } from './email';

const batch = (userIds: string[]) => ({
  userIds,
  act: { kind: 'design_approved' as const },
  deliveryLabel: 'DE-2026-0012 · Villa',
  deliveryUrl: 'https://metra.app/en/engagements/e1',
  locale: 'en',
});

beforeEach(() => {
  vi.useFakeTimers();
  getUserById.mockReset();
  sendClientActEmail.mockReset().mockResolvedValue({ sent: true });
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('emailClientActRecipients', () => {
  it('two new recipients: two lookups, two sends, counts logged', async () => {
    getUserById.mockImplementation(async (id: string) => ({
      data: { user: { email: `${id}@studio.example` } },
      error: null,
    }));
    await emailClientActRecipients(batch(['u1', 'u2']));

    expect(getUserById).toHaveBeenCalledTimes(2);
    expect(sendClientActEmail.mock.calls.map(([input]) => input.to).sort()).toEqual([
      'u1@studio.example',
      'u2@studio.example',
    ]);
    expect(console.info).toHaveBeenCalledWith('client act email:', {
      act: 'client_design_approved',
      sent: 2,
      failed: 0,
      noAddress: 0,
    });
  });

  it('a hung lookup is a failed email at AUTH_LOOKUP_TIMEOUT_MS; the other still sends', async () => {
    getUserById.mockImplementation((id: string) =>
      id === 'hung'
        ? new Promise(() => {})
        : Promise.resolve({ data: { user: { email: 'ok@studio.example' } }, error: null }),
    );
    const pending = emailClientActRecipients(batch(['hung', 'ok']));
    await vi.advanceTimersByTimeAsync(AUTH_LOOKUP_TIMEOUT_MS);
    await pending;

    expect(sendClientActEmail).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith('client act email:', {
      act: 'client_design_approved',
      sent: 1,
      failed: 1,
      noAddress: 0,
    });
  });

  it('logs no address and no user id', async () => {
    getUserById.mockResolvedValue({ data: { user: { email: 'secret@studio.example' } }, error: null });
    sendClientActEmail.mockResolvedValue({ sent: false });
    await emailClientActRecipients(batch(['user-id-1']));
    const logged = JSON.stringify([
      ...vi.mocked(console.info).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ]);
    expect(logged).not.toContain('secret@studio.example');
    expect(logged).not.toContain('user-id-1');
    expect(console.info).toHaveBeenCalledWith('client act email:', {
      act: 'client_design_approved',
      sent: 0,
      failed: 1,
      noAddress: 0,
    });
  });

  it('R1: never more than 4 recipients in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    getUserById.mockImplementation(async (id: string) => ({
      data: { user: { email: `${id}@studio.example` } },
      error: null,
    }));
    sendClientActEmail.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 100));
      inFlight -= 1;
      return { sent: true };
    });
    const pending = emailClientActRecipients(batch(Array.from({ length: 30 }, (_, i) => `u${i}`)));
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
    expect(CLIENT_ACT_EMAIL_CONCURRENCY).toBe(4);
    expect(peak).toBe(4);
    expect(sendClientActEmail).toHaveBeenCalledTimes(30);
    expect(console.info).toHaveBeenCalledWith('client act email:', {
      act: 'client_design_approved',
      sent: 30,
      failed: 0,
      noAddress: 0,
    });
  });

  it('R1: a queued recipient is not looked up (no deadline armed) until a slot frees', async () => {
    getUserById.mockImplementation(
      (id: string) =>
        new Promise((resolve) =>
          setTimeout(() => resolve({ data: { user: { email: `${id}@studio.example` } }, error: null }), 3_000),
        ),
    );
    const pending = emailClientActRecipients(batch(Array.from({ length: 10 }, (_, i) => `u${i}`)));
    await vi.advanceTimersByTimeAsync(0);
    expect(getUserById).toHaveBeenCalledTimes(4);
    // 3 waves of a 3 s lookup: 9 s, past AUTH_LOOKUP_TIMEOUT_MS from the start,
    // and nobody fails because each 8 s clock started with its own slot.
    await vi.advanceTimersByTimeAsync(3 * 3_000 + 100);
    await pending;
    expect(getUserById).toHaveBeenCalledTimes(10);
    expect(console.info).toHaveBeenCalledWith('client act email:', {
      act: 'client_design_approved',
      sent: 10,
      failed: 0,
      noAddress: 0,
    });
  });
});
