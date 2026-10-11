import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Lead addendum 1 (Round D): the budget act and the design act of one tap
// NEVER share one db.transaction. The hourly sweep takes the notifier's
// per-key advisory locks budget first; one transaction holding the budget's
// and the design's locks together deadlocked against it (288 of 300 in the D2
// reliability run). Driven through the real chain, down to the database
// handle: every token function call is its own statement on its own
// withRequestDb call, and no transaction is ever opened.

vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: () => {} }));

const ROM = '2026-10-01T09:00:00.123456+00:00';
const RENDERS = '2026-10-02T09:00:00.654321+00:00';
const ENGAGEMENT = '11111111-1111-4111-8111-111111111111';

const db = vi.hoisted(() => ({ statements: [] as Array<{ call: number; sdf: string }>, calls: 0, transactions: 0 }));

/** The token function a built statement calls (its leading literal text only). */
function sdfOf(query: SQL): string {
  const [first] = (query as unknown as { queryChunks: Array<{ value?: string[] }> }).queryChunks;
  return /public\.(app_[a-z_]+)/.exec(first?.value?.join('') ?? '')?.[1] ?? 'unknown';
}

vi.mock('@/lib/db/client', () => ({
  withRequestDb: async (run: (handle: unknown) => Promise<unknown>) => {
    db.calls += 1;
    const call = db.calls;
    return run({
      transaction: () => {
        db.transactions += 1;
        throw new Error('a client act opened a transaction');
      },
      execute: async (query: SQL) => {
        const sdf = sdfOf(query);
        db.statements.push({ call, sdf });
        if (sdf === 'app_delivery_respond_by_token') return [{ code: 'ok' }];
        if (sdf === 'app_delivery_notify_studio_by_token') {
          return [{ data: { engagement_id: ENGAGEMENT, locale: 'en', notified_count: 1, new_recipients: [] } }];
        }
        return [{ data: null }];
      },
    });
  },
}));

const { approveDesignWithBudgetAndNotify } = await import('./design-acts');

beforeEach(() => {
  db.statements = [];
  db.calls = 0;
  db.transactions = 0;
});

describe('approve design + budget: two writes, two statements, no transaction', () => {
  it('each write and each notification is its own withRequestDb call; db.transaction is never opened', async () => {
    const outcome = await approveDesignWithBudgetAndNotify('tok', { note: null }, { romIssuedAt: ROM, rendersIssuedAt: RENDERS });
    expect(outcome).toEqual({ kind: 'approved', studioNotified: true, budget: 'acknowledged' });
    expect(db.transactions).toBe(0);
    expect(db.statements.map((statement) => statement.sdf)).toEqual([
      'app_delivery_respond_by_token',
      'app_delivery_notify_studio_by_token',
      'app_delivery_respond_by_token',
      'app_delivery_notify_studio_by_token',
    ]);
    // One statement per call: nothing groups the budget's and the design's work.
    expect(new Set(db.statements.map((statement) => statement.call)).size).toBe(db.statements.length);
  });

  it('no module on the client-act path asks for a transaction', () => {
    const here = __dirname;
    const sources = [
      ...readdirSync(here).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts')).map((name) => join(here, name)),
      join(here, '..', 'public', 'respond.ts'),
      join(here, '..', '..', 'share', 'sdf-call.ts'),
    ];
    for (const source of sources) {
      expect(readFileSync(source, 'utf8'), source).not.toMatch(/\.transaction\s*\(/);
    }
  });
});
