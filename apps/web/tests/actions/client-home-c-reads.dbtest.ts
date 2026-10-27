import * as React from 'react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// H6.3 (AC5): what one /c request reads, the layout then the page, as Next
// runs them, against the real database. A redirect reads the home target
// alone and the page (with its contract read) never runs; a link with no home
// reads the target, then the contract. Every token function is counted at
// lib/share/sdf-call (the real one, spied).

const sdfCalls = vi.hoisted(() => ({ names: [] as string[] }));
vi.mock('@/lib/share/sdf-call', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/share/sdf-call')>();
  const nameOf = (query: unknown) => /public\.(app_[a-z0-9_]+)/.exec(JSON.stringify((query as { queryChunks: unknown[] }).queryChunks[0]))?.[1] ?? '?';
  return {
    ...original,
    readSdfJson: (query: unknown, options?: unknown) => {
      sdfCalls.names.push(nameOf(query));
      return original.readSdfJson(query as never, options as never);
    },
  };
});
// The page is called, never rendered: its client view is not this test's subject.
vi.mock('@/app/[locale]/c/[token]/public-contract', () => ({ PublicContractView: () => null }));

import ContractTokenLayout from '@/app/[locale]/c/[token]/layout';
import PublicContractPage from '@/app/[locale]/c/[token]/page';
import type { OrgContext } from '@/lib/db/context';
import { mintHomeLink } from './client-home-c-link-fixture';
import { seedHome } from './client-home-fixture';
import { closeExecutionFixture } from './execution-fixture';
import { closeFixture, ctxFor, seedOrg, teardown } from './fixture';

const orgIds: string[] = [];
let owner: OrgContext;

beforeAll(async () => {
  process.env.SHARE_LINK_SECRET = 'h63-share-link-secret-0123456789abcdef0123456789';
  const seeded = await seedOrg({ owners: 1 });
  owner = ctxFor(seeded.orgId, seeded.ownerIds[0], 'owner');
  orgIds.push(seeded.orgId);
});

beforeEach(() => {
  sdfCalls.names.length = 0;
});

afterAll(async () => {
  delete process.env.SHARE_LINK_SECRET;
  await teardown(orgIds);
  await closeExecutionFixture();
  await closeFixture();
});

/** One /c request: the layout, then the page (never reached when the layout redirects). */
async function open(token: string) {
  const params = Promise.resolve({ locale: 'en', token });
  await ContractTokenLayout({ children: null, params });
  vi.stubGlobal('React', React); // the actions runner compiles JSX to React.createElement
  try {
    await PublicContractPage({ params });
  } finally {
    vi.unstubAllGlobals();
  }
}

describe('what each /c request reads (AC5)', () => {
  it('the redirect reads the target alone; the page, and its contract read, never run', async () => {
    const home = await seedHome(owner.orgId, 'issued');
    await mintHomeLink(owner, home);
    const thrown = await open(home.contract.rawToken as string).catch((error: unknown) => error);
    expect((thrown as { digest?: string }).digest).toMatch(/^NEXT_REDIRECT;replace;\/en\/d\/.+;307;$/);
    expect(sdfCalls.names).toEqual(['app_client_home_target_by_token']);
  });

  it('a link with no home: the target, then the contract', async () => {
    const home = await seedHome(owner.orgId, 'issued');
    await open(home.contract.rawToken as string);
    expect(sdfCalls.names).toEqual(['app_client_home_target_by_token', 'app_contract_by_token']);
  });
});
