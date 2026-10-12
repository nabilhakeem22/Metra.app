import { describe, expect, it } from 'vitest';
import { workerSourceFiles } from '@/test/source-files';

// Round E: Cloudflare Workers THROW on fetch(url, { redirect: 'error' }), while
// Node (and so every unit test) accepts it. That once turned every logo into a
// 404 in production with the whole suite green. `redirect: 'manual'` refuses a
// redirect just as well (a 3xx is not ok), so 'error' has no place in anything
// the Worker or the cron Worker runs. Read from the source, any quote, any case,
// as an object key (quoted or not) or an assignment (`init.redirect = 'error'`,
// `init['redirect'] = 'error'`). OUT OF REACH (Round E F4): 'error' held in a
// variable or built at runtime (`redirect: MODE`), which review must catch.

const ROOTS = ['apps/web/src', 'apps/web/scripts', 'packages', 'scripts', 'workers'];

/** `redirect: 'error'` or `.redirect = 'error'`: any quote around the key and the value, any case. */
const REDIRECT_ERROR = /['"`]?redirect['"`]?\]?\s*[:=]\s*['"`]error['"`]/gi;

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
    ['a single-quoted key', "fetch(u, { 'redirect': 'error' })"],
    ['a double-quoted key', 'fetch(u, { "redirect": "error" })'],
    ['an assignment', "init.redirect = 'error';"],
    ['a bracket assignment', "init['redirect'] = 'error';"],
  ])('the matcher is sound: it finds %s', (_label, source) => {
    expect(redirectErrorCount(source)).toBe(1);
  });

  it("the matcher leaves 'manual', 'follow' and a comparison alone", () => {
    expect(redirectErrorCount("fetch(u, { redirect: 'manual' }); fetch(v, { redirect: 'follow' })")).toBe(0);
    expect(redirectErrorCount("if (init.redirect === 'error') refuse();")).toBe(0);
  });
});
