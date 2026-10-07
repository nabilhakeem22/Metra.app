import { describe, expect, it, vi } from 'vitest';

// The audit provenance of a portal write: the edge IP first, the first forwarded
// hop otherwise, both capped, and the user agent capped at 512.
const state = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => state.headers }));

const { requestProvenance } = await import('./request-provenance');

describe('requestProvenance', () => {
  it('prefers the edge header and caps both fields', async () => {
    state.headers = new Headers({
      'cf-connecting-ip': ` ${'1'.repeat(60)} `,
      'x-forwarded-for': '9.9.9.9',
      'user-agent': 'u'.repeat(900),
    });
    expect(await requestProvenance()).toEqual({ ip: '1'.repeat(45), userAgent: 'u'.repeat(512) });
  });

  it('falls back to the FIRST forwarded hop, and to null when nothing is sent', async () => {
    state.headers = new Headers({ 'x-forwarded-for': ' 5.6.7.8 , 10.0.0.1' });
    expect(await requestProvenance()).toEqual({ ip: '5.6.7.8', userAgent: null });
    state.headers = new Headers();
    expect(await requestProvenance()).toEqual({ ip: null, userAgent: null });
  });
});
