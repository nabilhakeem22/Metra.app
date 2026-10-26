// The code email goes through the same deadlined dispatch as every sender:
// Resend is never reached from a test (the SDK is replaced here), a refusal or
// a missing key is `{ sent: false }`, and a hung origin gives up at
// EMAIL_TIMEOUT_MS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const secrets: Record<string, string | undefined> = {
  RESEND_API_KEY: 're-test-key',
  RESEND_FROM: 'codes@example.com',
};
vi.mock('@/lib/cf/secrets', () => ({
  runtimeSecret: (name: string) => secrets[name],
}));

const send = vi.fn<(payload: { to: string; subject: string; text: string }) => Promise<{ error: unknown }>>();
vi.mock('resend', () => ({
  Resend: class {
    emails = { send };
  },
}));

import { EMAIL_TIMEOUT_MS } from '@/lib/http/deadlines';
import { sendClientCodeEmail } from './client-code';

const input = {
  to: 'client@example.org',
  code: '042917',
  purpose: 'claim_request' as const,
  documentNumber: 'PR-2026-0007',
  studioName: 'Diwan Studio',
  homeUrl: 'https://metra.app/en/d/tok?tab=execution',
  locale: 'en',
};

beforeEach(() => {
  vi.useFakeTimers();
  send.mockReset();
  secrets.RESEND_API_KEY = 're-test-key';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('sendClientCodeEmail', () => {
  it('sends the code template to the client\'s address', async () => {
    send.mockResolvedValue({ error: null });
    await expect(sendClientCodeEmail(input)).resolves.toEqual({ sent: true });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'client@example.org', from: 'codes@example.com', subject: 'Your verification code: 042917' }),
    );
  });

  it('a refusal (the sending domain not verified) is not sent', async () => {
    send.mockResolvedValue({ error: { statusCode: 403, name: 'validation_error' } });
    await expect(sendClientCodeEmail(input)).resolves.toEqual({ sent: false, transient: false });
  });

  it('no key on the Worker is not sent, and nothing is called', async () => {
    secrets.RESEND_API_KEY = undefined;
    await expect(sendClientCodeEmail(input)).resolves.toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('gives up on a hung origin at EMAIL_TIMEOUT_MS, and its log line carries neither the code nor the address', async () => {
    send.mockReturnValue(new Promise(() => {}));
    const pending = sendClientCodeEmail(input);
    await vi.advanceTimersByTimeAsync(EMAIL_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ sent: false, transient: true });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain('sendClientCodeEmail failed:');
    expect(logged).not.toContain('042917');
    expect(logged).not.toContain('client@example.org');
  });
});
