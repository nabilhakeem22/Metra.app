import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const onCloudflare = vi.fn();
const env = vi.fn();

vi.mock('./context', () => ({
  isCloudflareRuntime: () => onCloudflare(),
  cfEnv: () => env(),
}));

const { runtimeSecret } = await import('./secrets');

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.TEST_SECRET;
});

// The point of this module is that a secret is read at REQUEST time rather than
// folded into the Worker bundle by the bundler. These cases pin the two halves
// of that — where each runtime reads from — and the "absent" contract, which
// differs per caller: the service-role key must be fatal, the Resend key must
// not be.

describe('runtimeSecret on Cloudflare', () => {
  it("reads the Worker's per-request env, not process.env", () => {
    onCloudflare.mockReturnValue(true);
    env.mockReturnValue({ TEST_SECRET: 'from-worker' });
    process.env.TEST_SECRET = 'from-process';
    expect(runtimeSecret('TEST_SECRET')).toBe('from-worker');
  });

  it('does not fall back to process.env when the Worker has no such secret', () => {
    // Falling back would make a missing `wrangler secret put` look like it
    // worked in whatever environment happened to have the var set.
    onCloudflare.mockReturnValue(true);
    env.mockReturnValue({});
    process.env.TEST_SECRET = 'from-process';
    expect(runtimeSecret('TEST_SECRET')).toBeUndefined();
  });

  it('treats a non-string or empty binding as absent', () => {
    onCloudflare.mockReturnValue(true);
    for (const value of [undefined, '', 0, {}, null]) {
      env.mockReturnValue({ TEST_SECRET: value });
      expect(runtimeSecret('TEST_SECRET')).toBeUndefined();
    }
  });
});

describe('runtimeSecret off platform', () => {
  it('reads process.env, which is where a developer"s .env actually is', () => {
    onCloudflare.mockReturnValue(false);
    process.env.TEST_SECRET = 'from-process';
    expect(runtimeSecret('TEST_SECRET')).toBe('from-process');
    expect(env).not.toHaveBeenCalled();
  });

  it('treats an unset or empty var as absent', () => {
    onCloudflare.mockReturnValue(false);
    expect(runtimeSecret('TEST_SECRET')).toBeUndefined();
    process.env.TEST_SECRET = '';
    expect(runtimeSecret('TEST_SECRET')).toBeUndefined();
  });
});

describe('the lookup is by VARIABLE, which is what keeps it out of the bundle', () => {
  it('resolves a name computed at runtime', () => {
    // A bundler folds `process.env.LITERAL` into a string. It cannot fold
    // `env[name]`, and that is the whole mechanism — so it must keep working
    // when the name is genuinely not a literal.
    onCloudflare.mockReturnValue(false);
    process.env.TEST_SECRET = 'value';
    const name = ['TEST', 'SECRET'].join('_');
    expect(runtimeSecret(name)).toBe('value');
  });
});
