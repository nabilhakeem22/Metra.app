import { describe, expect, it } from 'vitest';
import { AUTH_OTP_IDENTIFIER_CEILING, AUTH_OTP_IP_CEILING } from './wrangler-rate-limits';

// Go-live security fix round, T4. The IP bucket is charged first, so one
// source can spend at most the IP ceiling on any one address per minute. With
// the per-address ceiling above it, that source alone can never exhaust the
// address's budget and lock its owner out of sign-in.

describe('the sign-in throttle ceilings in wrangler.jsonc', () => {
  it('keep the per-address ceiling above the per-IP ceiling', () => {
    expect(AUTH_OTP_IDENTIFIER_CEILING).toBeGreaterThan(AUTH_OTP_IP_CEILING);
  });

  it('are the lead-ruled numbers: 10 per IP, 15 per address, per minute and step', () => {
    expect([AUTH_OTP_IP_CEILING, AUTH_OTP_IDENTIFIER_CEILING]).toEqual([10, 15]);
  });
});
