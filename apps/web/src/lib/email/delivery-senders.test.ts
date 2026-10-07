// The delivery emails go through the same deadlined dispatch as every other
// sender: a hung Resend is a `{ sent: false }` at EMAIL_TIMEOUT_MS, never a
// promise that outlives the request's after() budget.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const secrets: Record<string, string | undefined> = {
  RESEND_API_KEY: 're-test-key',
  RESEND_FROM: 'studio@example.com',
};
vi.mock('@/lib/cf/secrets', () => ({
  runtimeSecret: (name: string) => secrets[name],
}));

const send = vi.fn<(payload: { to: string; subject: string }) => Promise<{ error: unknown }>>();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

import { EMAIL_TIMEOUT_MS } from '@/lib/http/deadlines';
import { sendClientActEmail } from './delivery-senders';

const input = {
  to: 'owner@studio.example',
  act: { kind: 'design_approved' as const },
  deliveryLabel: 'DE-2026-0012 · Villa',
  deliveryUrl: 'https://metra.app/en/engagements/11111111-1111-4111-8111-111111111111',
  locale: 'en',
};

beforeEach(() => {
  vi.useFakeTimers();
  send.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sendClientActEmail', () => {
  it('sends the client-act template to the one member', async () => {
    send.mockResolvedValue({ error: null });
    await expect(sendClientActEmail(input)).resolves.toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@studio.example',
        subject: 'The client responded on DE-2026-0012 · Villa',
      }),
    );
  });

  it('gives up on a hung origin at EMAIL_TIMEOUT_MS', async () => {
    send.mockReturnValue(new Promise(() => {}));
    const pending = sendClientActEmail(input);
    await vi.advanceTimersByTimeAsync(EMAIL_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ sent: false });
    expect(console.error).toHaveBeenCalledWith(
      'sendClientActEmail failed:',
      expect.objectContaining({ name: 'HttpDeadlineError' }),
    );
  });
});
