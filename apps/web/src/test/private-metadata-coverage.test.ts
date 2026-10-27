import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SRC_ROOT } from './source-graph';

// Every page under app/[locale] is noindex in its HTML (the robots meta), on
// top of the middleware's X-Robots-Tag header, except the one indexable page,
// the landing. A page is covered when its route group's layout exports
// PRIVATE_METADATA, or when it imports that metadata itself (directly, or via
// the client page's delivery-metadata module). A new page that is none of
// these fails here instead of shipping indexable.

const LOCALE_ROOT = join(SRC_ROOT, 'app', '[locale]');

/** Not checked: the landing (indexable on purpose) and the catch-all (it only calls notFound(), which Next renders noindex). */
const EXEMPT_PAGES = new Set(['page.tsx', join('[...rest]', 'page.tsx')]);

/** Route groups whose layout exports PRIVATE_METADATA for every page below it. */
const PRIVATE_GROUPS = ['(app)', '(auth)'];

const PRIVATE_IMPORT = /from '(@\/lib\/seo\/private-metadata|\.\/delivery-metadata)'/;

function pagesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pagesUnder(path);
    return entry.name === 'page.tsx' ? [path] : [];
  });
}

function isCovered(page: string): boolean {
  const group = relative(LOCALE_ROOT, page).split(sep)[0]!;
  return PRIVATE_GROUPS.includes(group) || PRIVATE_IMPORT.test(readFileSync(page, 'utf8'));
}

describe('private metadata coverage', () => {
  it('each private-group layout exports PRIVATE_METADATA', () => {
    for (const group of PRIVATE_GROUPS) {
      const layout = readFileSync(join(LOCALE_ROOT, group, 'layout.tsx'), 'utf8');
      expect(layout, group).toMatch(/export const metadata: Metadata = PRIVATE_METADATA;/);
    }
  });

  it('every page but the landing and the catch-all is noindex in its HTML', () => {
    const pages = pagesUnder(LOCALE_ROOT).filter((page) => !EXEMPT_PAGES.has(relative(LOCALE_ROOT, page)));
    expect(pages.length).toBeGreaterThan(10);
    expect(pages.filter((page) => !isCovered(page)).map((page) => relative(SRC_ROOT, page))).toEqual([]);
  });

  it('the delivery metadata module itself carries PRIVATE_METADATA', () => {
    const source = readFileSync(join(LOCALE_ROOT, 'd', '[token]', 'delivery-metadata.ts'), 'utf8');
    expect(source).toContain("from '@/lib/seo/private-metadata'");
  });
});
