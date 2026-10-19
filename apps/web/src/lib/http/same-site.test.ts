import { describe, expect, it } from 'vitest';
import { fromThisSite } from './same-site';

const request = (headers: Record<string, string>) => new Request('https://metra.app/api/x', { method: 'POST', headers });

describe('fromThisSite', () => {
  it('accepts an Origin on this host only', () => {
    expect(fromThisSite(request({ origin: 'https://metra.app', host: 'metra.app' }))).toBe(true);
    expect(fromThisSite(request({ origin: 'https://evil.example', host: 'metra.app' }))).toBe(false);
    expect(fromThisSite(request({ origin: 'null', host: 'metra.app' }))).toBe(false);
    expect(fromThisSite(request({ host: 'metra.app' }))).toBe(false);
  });
});
