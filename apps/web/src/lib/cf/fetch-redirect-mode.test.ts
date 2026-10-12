import { describe, expect, it } from 'vitest';
import { workerSourceFiles } from '@/test/source-files';

// Round E: Cloudflare Workers THROW on fetch(url, { redirect: 'error' }), while
// Node (and so every unit test) accepts it. That once turned every logo into a
// 404 in production with the whole suite green. `redirect: 'manual'` refuses a
// redirect just as well (a 3xx is not ok), so 'error' has no place in anything
// the Worker or the cron Worker runs. Read from the source, any quote, any case.

const ROOTS = ['apps/web/src', 'apps/web/scripts', 'packages', 'scripts', 'workers'];

/** `redirect: 'error'`, in any quote and any case, with any white space around the colon. */
const REDIRECT_ERROR = /redirect\s*:\s*['"`]error['"`]/gi;

function redirectErrorCount(source: string): number {
  return [...source.matchAll(REDIRECT_ERROR)].length;
}

describe("fetch's redirect mode in Worker source", () => {
  it("is never 'error' (Workers throw on it)", () => {
    const offenders = workerSourceFiles(ROOTS)
      .filter((file) => redirectErrorCount(file.text) > 0)
      .map((file) => file.path);
    expect(offenders).toEqual([]);
  });

  it('reads the apps, the packages, the scripts and the workers', () => {
    const paths = workerSourceFiles(ROOTS).map((file) => file.path);
    expect(paths).toContain('apps/web/src/lib/storage/bounded-image-fetch.ts');
    expect(paths.some((path) => path.startsWith('workers/cron/'))).toBe(true);
  });

  it.each([
    ['double quotes', 'fetch(u, { redirect: "error" })'],
    ['upper case, no spaces', "fetch(u, {redirect:'ERROR'})"],
    ['a template literal', 'fetch(u, { redirect : `error` })'],
  ])('the matcher is sound: it finds %s', (_label, source) => {
    expect(redirectErrorCount(source)).toBe(1);
  });

  it("the matcher leaves 'manual' and 'follow' alone", () => {
    expect(redirectErrorCount("fetch(u, { redirect: 'manual' }); fetch(v, { redirect: 'follow' })")).toBe(0);
  });
});
