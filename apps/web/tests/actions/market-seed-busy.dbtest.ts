import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MARKET_WRITE_LOCK } from '@metra/db/market-seed';
import { loadMarketPriceBookCore, seedNewStudioCore } from '@/lib/market-book/seed-core';
import { closeFixture, teardown } from './fixture';
import { closeMarketFixture, marketRaw } from './market-fixture';
import { clearSeedFixture, createStudio, publishSeedFixture, rebuildSeedBook, seededRows } from './market-seed-fixture';

// R4: a seed that waited out the app's 5 s lock timeout behind a publish
// (which holds the market book exclusively while it rebuilds it) answered
// `uncertain`, "we could not confirm your change was saved". It saved
// nothing: it now answers `market_book_busy`, and the next try loads.

const orgIds: string[] = [];

beforeAll(async () => {
  await publishSeedFixture();
  await rebuildSeedBook();
});

afterAll(async () => {
  await teardown(orgIds);
  await clearSeedFixture();
  await closeMarketFixture();
  await closeFixture();
});

/** A publish's transaction, holding the market write lock exclusively until `release` is called. */
async function publishHoldingTheBook(): Promise<{ release: () => Promise<void> }> {
  let release!: () => void;
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
  const held = marketRaw().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${MARKET_WRITE_LOCK}))`;
    locked();
    await new Promise<void>((resolve) => { release = resolve; });
  });
  await lockTaken;
  return { release: async () => { release(); await held; } };
}

describe('a seed behind a publish that holds the book past the lock timeout', () => {
  it('answers market_book_busy from the button and from the sign-up seed, writes nothing, and the next try loads', async () => {
    const studio = await createStudio(orgIds, 'Busy behind a publish');
    const publish = await publishHoldingTheBook();
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const started = Date.now();
      expect(await loadMarketPriceBookCore(studio)).toEqual({ ok: false, error: 'market_book_busy' });
      expect(Date.now() - started).toBeGreaterThanOrEqual(4_500);
      expect(await seedNewStudioCore(studio)).toEqual({ ok: false, error: 'market_book_busy' });
      // R5: each busy answer leaves one redacted line naming the locks and the wait.
      const busyLines = warned.mock.calls.filter(([label]) => label === 'market_book_busy');
      expect(busyLines).toHaveLength(2);
      for (const [, detail] of busyLines) {
        expect(detail).toMatchObject({ locks: ['metra.market.publish', 'metra.market.seed-studio'], failure: { code: '55P03' } });
        expect((detail as { waitedMs: number }).waitedMs).toBeGreaterThanOrEqual(4_500);
      }
    } finally {
      warned.mockRestore();
      await publish.release();
    }
    expect(await seededRows(studio.orgId)).toEqual([]);
    const next = await loadMarketPriceBookCore(studio);
    expect(next).toMatchObject({ ok: true, data: { book: 'ready' } });
    expect(await seededRows(studio.orgId)).toHaveLength(next.data?.items as number);
  });
});
