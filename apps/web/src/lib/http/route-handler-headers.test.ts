import { describe, expect, it } from 'vitest';
import { workerSourceFiles } from '@/test/source-files';
import { ROUTE_HANDLER_HEADERS } from './route-handler-headers';

// C6: /api responses never pass through the middleware (its matcher skips
// /api, for Worker CPU; src/middleware-matcher.test.ts), so every handler
// there sets these two headers itself: directly, or through the one response
// builder its route family shares.

/** The shared builders: the PDF routes, the Public API (v1) and the sign-in code routes. */
const RESPONSE_BUILDERS = ['apps/web/src/lib/pdf/responses.ts', 'apps/web/src/lib/api/errors.ts', 'apps/web/src/lib/auth/otp-route.ts'];

/** A handler answers with the constant itself, or through servePdfDocument, handleApiRequest or otpEndpoint. */
const SETS_THE_HEADERS = /ROUTE_HANDLER_HEADERS|\b(?:servePdfDocument|handleApiRequest|otpEndpoint)\(/;

describe('ROUTE_HANDLER_HEADERS', () => {
  it('is nosniff and no-referrer, and nothing else', () => {
    expect(ROUTE_HANDLER_HEADERS).toEqual({ 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
  });

  it('is what every shared response builder behind app/api spreads', () => {
    const builders = workerSourceFiles(['apps/web/src/lib/pdf', 'apps/web/src/lib/api', 'apps/web/src/lib/auth']).filter((file) =>
      RESPONSE_BUILDERS.includes(file.path),
    );
    expect(builders.map((builder) => builder.path)).toEqual(RESPONSE_BUILDERS);
    for (const builder of builders) expect(builder.text, builder.path).toContain('...ROUTE_HANDLER_HEADERS');
  });

  it('every handler under app/api answers with it, or through one of those builders', () => {
    const handlers = workerSourceFiles(['apps/web/src/app/api']).filter((file) => file.path.endsWith('/route.ts'));
    expect(handlers.length).toBeGreaterThanOrEqual(17);
    for (const handler of handlers) expect(handler.text, handler.path).toMatch(SETS_THE_HEADERS);
  });
});
