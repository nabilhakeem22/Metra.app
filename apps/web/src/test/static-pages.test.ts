import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSourceGraph, SRC_ROOT, srcRelative, type SourceGraph } from './source-graph';

// The landing and login pages are pre-rendered and served as static assets
// before the Worker runs (Workers Free plan CPU relief). Two things would break
// that, and only in production, where there is an asset layer:
// - a server action reachable from them: Next posts an action to the CURRENT
//   page URL, and a POST to an asset path is a 405, so the action never runs;
// - a request-time or server-only dependency (the database, the request
//   headers, a Supabase server client): the page stops being static (the build
//   fails on `dynamic = 'error'`) or drags the database chunk into the page.
// This walks every module the two pages and their layouts load.

/** The pre-rendered pages and the layouts that wrap them. */
const STATIC_PAGE_ENTRIES = [
  'app/[locale]/layout.tsx',
  'app/[locale]/page.tsx',
  'app/[locale]/(auth)/layout.tsx',
  'app/[locale]/(auth)/login/page.tsx',
];

/** Packages a static page must never load. */
const SERVER_ONLY_PACKAGES = [
  '@metra/db',
  '@metra/db/schema',
  '@metra/db/client',
  'drizzle-orm',
  'postgres',
  'next/headers',
  '@supabase/ssr',
  '@supabase/supabase-js',
];

/** Each module reachable from `entries`, entries included. */
function reachedFrom(graph: SourceGraph, entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const pending = entries.map((entry) => join(SRC_ROOT, entry));
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    pending.push(...graph.importsOf(path));
  }
  return [...seen];
}

/** What a static page must not reach: action modules and server-only packages. */
function staticPageOffences(graph: SourceGraph, entries: readonly string[] = STATIC_PAGE_ENTRIES): string[] {
  return reachedFrom(graph, entries).flatMap((path) => {
    const relative = srcRelative(path);
    const offences = graph.directiveOf(path) === 'use server' ? [`${relative} is a 'use server' module`] : [];
    const packages = graph.packagesOf(path).filter((specifier) => SERVER_ONLY_PACKAGES.includes(specifier));
    return [...offences, ...packages.map((specifier) => `${relative} imports ${specifier}`)];
  });
}

describe('the static landing and login pages', () => {
  const graph = loadSourceGraph();

  it('every entry exists', () => {
    for (const entry of STATIC_PAGE_ENTRIES) expect(graph.files.has(join(SRC_ROOT, entry)), entry).toBe(true);
  });

  it('reach no server action and no server-only package', () => {
    expect(staticPageOffences(graph)).toEqual([]);
  });

  it('the guard sees a server action and the database when they are reachable (control)', () => {
    // The account settings client posts the signOut action; the post-login probe reads the database.
    expect(staticPageOffences(graph, ['app/[locale]/(app)/settings/account/account-client.tsx'])).toContain(
      "lib/auth/actions.ts is a 'use server' module",
    );
    expect(staticPageOffences(graph, ['lib/auth/post-login-path.ts'])).toEqual(
      expect.arrayContaining(['lib/auth/post-login-path.ts imports drizzle-orm', 'lib/db/context.ts imports @metra/db']),
    );
  });
});
