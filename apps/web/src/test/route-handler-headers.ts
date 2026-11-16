import { expect } from 'vitest';

// TEST-ONLY. The two security headers every /api route handler sets
// (lib/http/route-handler-headers.ts), asserted on a real response so each
// handler's tests say it the same way.

export function expectRouteHandlerHeaders(response: Response): void {
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
}
