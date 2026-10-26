import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { workerSourceFiles } from '@/test/source-files';

// Every studio page that takes an [id] answers a malformed one with notFound()
// BEFORE any read. Without the guard, /clients/not-a-uuid reached a uuid cast and
// Postgres raised 22P02, which rendered "Application error" instead of a 404.

const NOT_FOUND = new Error('NEXT_NOT_FOUND');

const deps = vi.hoisted(() => ({
  requireOrg: vi.fn(),
  withOrgContext: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  notFound: () => {
    throw NOT_FOUND;
  },
}));
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'en',
  getTranslations: async () => (key: string) => key,
}));
vi.mock('@/lib/auth/require-org', () => ({ requireOrg: deps.requireOrg }));
vi.mock('@/lib/db/context', () => ({ withOrgContext: deps.withOrgContext }));

type IdPage = (props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) => Promise<unknown>;

const PAGES: ReadonlyArray<[family: string, load: () => Promise<{ default: unknown }>]> = [
  ['clients/[id]', () => import('./clients/[id]/page')],
  ['contracts/[id]', () => import('./contracts/[id]/page')],
  ['contracts/[id]/costs', () => import('./contracts/[id]/costs/page')],
  ['contracts/[id]/measurements', () => import('./contracts/[id]/measurements/page')],
  ['engagements/[id]', () => import('./engagements/[id]/page')],
  ['projects/[id]', () => import('./projects/[id]/page')],
  ['proposals/[id]', () => import('./proposals/[id]/page')],
  ['proposals/[id]/view', () => import('./proposals/[id]/view/page')],
];

async function render(load: () => Promise<{ default: unknown }>, id: string) {
  const page = (await load()).default as IdPage;
  return page({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
}

// A page's first import pulls its whole module graph (seconds under a full,
// parallel run). Paid once here, on a hook budget, instead of by whichever case
// happens to run first against the 5 s test budget.
beforeAll(async () => {
  await Promise.all(PAGES.map(([, load]) => load()));
}, 60_000);

beforeEach(() => {
  deps.requireOrg.mockReset();
  deps.requireOrg.mockResolvedValue({ orgId: 'org-1', userId: 'user-1', role: 'owner' });
  deps.withOrgContext.mockReset();
  // An empty result: whatever the page reads first resolves to "no such row".
  deps.withOrgContext.mockResolvedValue([]);
});

it('covers every [id] page under the studio, so a new one cannot skip the guard', () => {
  const STUDIO = 'apps/web/src/app/[locale]/(app)/';
  const onDisk = workerSourceFiles([STUDIO])
    .map(({ path }) => path.slice(STUDIO.length))
    .filter((path) => path.includes('[id]') && path.endsWith('/page.tsx'))
    .map((path) => path.slice(0, -'/page.tsx'.length))
    .sort();
  expect(onDisk).toEqual(PAGES.map(([family]) => family).sort());
});

describe.each(PAGES)('/%s', (_family, load) => {
  it.each(['not-a-uuid', '1', "3f2504e0-4f89-41d3-9a0c-0305e82c3301' or 1=1--"])(
    'answers the malformed id %j with notFound() and reads nothing',
    async (id) => {
      await expect(render(load, id)).rejects.toBe(NOT_FOUND);
      expect(deps.withOrgContext).not.toHaveBeenCalled();
    },
  );

  it('does read for a well-formed id (so the check above is not vacuous)', async () => {
    // What the page does with an empty result is beside the point; that it got
    // as far as asking the database is the point.
    await render(load, '3f2504e0-4f89-41d3-9a0c-0305e82c3301').catch(() => undefined);
    expect(deps.withOrgContext).toHaveBeenCalled();
  });
});
