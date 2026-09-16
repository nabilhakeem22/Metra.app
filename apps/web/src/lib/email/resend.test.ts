// What the studio is told when Resend does not answer. Every sender here is
// best-effort BY DESIGN — the proposal is already sent and the share link
// already minted before the email is attempted — so the only question is
// whether the caller gets an answer at all.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const secrets: Record<string, string | undefined> = {
  RESEND_API_KEY: 're-test-key',
  RESEND_FROM: 'studio@example.com',
};
vi.mock('@/lib/cf/secrets', () => ({
  runtimeSecret: (name: string) => secrets[name],
}));

const send = vi.fn<() => Promise<{ error: unknown }>>();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

import { EMAIL_TIMEOUT_MS } from '@/lib/http/deadlines';
import { sendProposalEmail } from './resend';

const input = {
  to: 'client@example.com',
  orgName: 'Diwan',
  proposalNumber: 'PRO-2026-0007',
  totalDisplay: null,
  expiryDate: null,
  acceptUrl: 'https://metra.app/p/token',
  locale: 'ar-EG',
};

beforeEach(() => {
  vi.useFakeTimers();
  send.mockReset();
  secrets.RESEND_API_KEY = 're-test-key';
  secrets.RESEND_FROM = 'studio@example.com';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sendProposalEmail', () => {
  it('reports a send that Resend accepted', async () => {
    send.mockResolvedValue({ error: null });
    await expect(sendProposalEmail(input)).resolves.toEqual({ sent: true });
  });

  it('gives up on a hung origin instead of holding the action open', async () => {
    // Awaited on the user-facing path AFTER sendProposalCore has committed. With
    // no deadline a dead Resend held the server action until the platform killed
    // the request, and the studio never got the link the action exists to return.
    send.mockReturnValue(new Promise(() => {}));
    const pending = sendProposalEmail(input);
    // The SDK is loaded by a dynamic import, so the deadline's timer is armed a
    // few microtasks in. Let those drain before the clock moves.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(EMAIL_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ sent: false });
    expect(console.error).toHaveBeenCalledWith(
      'sendProposalEmail failed:',
      expect.objectContaining({ name: 'HttpDeadlineError' }),
    );
  });

  it('is a no-op without a key, and never throws on a Resend error', async () => {
    secrets.RESEND_API_KEY = undefined;
    await expect(sendProposalEmail(input)).resolves.toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();

    secrets.RESEND_API_KEY = 're-test-key';
    send.mockResolvedValue({ error: { message: 'domain not verified' } });
    await expect(sendProposalEmail(input)).resolves.toEqual({ sent: false });

    send.mockRejectedValue(new Error('network'));
    await expect(sendProposalEmail(input)).resolves.toEqual({ sent: false });
  });
});
