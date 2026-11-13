import { describe, expect, it } from 'vitest';
import { workerSourceFiles } from '@/test/source-files';
import { expectRouteHandlerHeaders } from '@/test/route-handler-headers';
import { API_RESPONSE_HEADERS, problemFromActionCode, problemResponse } from './errors';

// C6: every Public API (v1) answer, a 200 or a problem, is never cached and
// carries the route-handler security headers.

describe('the Public API response headers (C6)', () => {
  it('are no-store, nosniff and no-referrer', () => {
    expect(API_RESPONSE_HEADERS).toEqual({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
  });

  it('are on every problem, with its status, content type and added headers unchanged', async () => {
    const limited = problemResponse('rate-limited', { headers: { 'retry-after': '60' } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('content-type')).toBe('application/problem+json');
    expect(limited.headers.get('retry-after')).toBe('60');
    expect(await limited.json()).toMatchObject({ status: 429, title: 'Too Many Requests' });
    for (const problem of [limited, problemResponse('internal'), problemFromActionCode('forbidden')]) {
      expect(problem.headers.get('cache-control')).toBe('no-store');
      expectRouteHandlerHeaders(problem);
    }
  });

  it('are what the pipeline puts on a 200', () => {
    const pipeline = workerSourceFiles(['apps/web/src/lib/api']).find((file) => file.path.endsWith('/pipeline.ts'));
    expect(pipeline?.text).toContain("headers: { 'content-type': 'application/json', ...API_RESPONSE_HEADERS }");
  });
});
