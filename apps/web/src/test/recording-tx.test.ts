// The recording transaction double, pinned on one real table (`clients`): what a
// statement renders as, the order results are handed out in, and what an
// unscripted statement does. The characterization tests under lib/engagements
// rest on these strings meaning what they say.
import { clients } from '@metra/db';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createRecordingTx } from './recording-tx';

const CLIENT_BY_ID =
  'select({id: clients.id}).from(table:clients).where(sql("clients"."id" = $1 ["c-1"])).limit(1)';

describe('createRecordingTx', () => {
  it('(a) journals a select with its predicate AND params, and resolves the queued row', async () => {
    const db = createRecordingTx();
    db.respond([{ id: 'c-1' }]);
    const rows = await db.tx.select({ id: clients.id }).from(clients).where(eq(clients.id, 'c-1')).limit(1);
    expect(rows).toEqual([{ id: 'c-1' }]);
    expect(db.journal).toEqual([CLIENT_BY_ID]);
    expect(db.pending()).toBe(0);
  });

  it('(a) renders a different bound value as a different string', async () => {
    const db = createRecordingTx();
    db.respond([]);
    await db.tx.select({ id: clients.id }).from(clients).where(eq(clients.id, 'c-2')).limit(1);
    expect(db.journal).toEqual([
      'select({id: clients.id}).from(table:clients).where(sql("clients"."id" = $1 ["c-2"])).limit(1)',
    ]);
  });

  it('(b) hands the queued results out in await order', async () => {
    const db = createRecordingTx();
    db.respond(['first'], ['second'], ['unused']);
    const first = await db.tx.select().from(clients);
    const second = await db.tx.delete(clients).where(eq(clients.id, 'c-1'));
    expect([first, second]).toEqual([['first'], ['second']]);
    expect(db.journal).toEqual([
      'select().from(table:clients)',
      'delete(table:clients).where(sql("clients"."id" = $1 ["c-1"]))',
    ]);
    expect(db.pending()).toBe(1);
  });

  it('(c) rejects an unscripted statement with a constant message, after journalling it', async () => {
    const db = createRecordingTx();
    // Awaited directly, as the code under test does: READING a statement's `then`
    // is what finishes it, so it is read exactly once here.
    const rejection = await (async () => {
      try {
        await db.tx.select().from(clients);
        return null;
      } catch (reason) {
        return reason;
      }
    })();
    expect(rejection).toEqual(new Error('recording-tx: no scripted result left'));
    expect((rejection as Error).message).toBe('recording-tx: no scripted result left');
    expect(db.journal).toEqual(['select().from(table:clients)']);
  });

  it('(d) is not thenable itself, so an async callback can return it', () => {
    const db = createRecordingTx();
    expect((db.tx as unknown as { then: unknown }).then).toBe(undefined);
  });

  it('(e) renders dates, bigints, null and nested values as specified', () => {
    const { render } = createRecordingTx();
    expect(render(new Date('2026-11-14T10:00:00.000Z'))).toBe('Date(2026-11-14T10:00:00.000Z)');
    expect(render(30000n)).toBe('30000n');
    expect(render(null)).toBe('null');
    expect(render(undefined)).toBe('undefined');
    expect(render([1, ['a', null], true])).toBe('[1, ["a", null], true]');
    expect(render({ amount: '1.0000', nested: { at: null } })).toBe('{amount: "1.0000", nested: {at: null}}');
    expect(render(clients)).toBe('table:clients');
    expect(render(clients.id)).toBe('clients.id');
    expect(render(() => undefined)).toBe('<function>');
  });

  it('(f) reset empties both the journal and the queue', async () => {
    const db = createRecordingTx();
    db.respond(['used'], ['left over']);
    await db.tx.select().from(clients);
    db.reset();
    expect(db.journal).toEqual([]);
    expect(db.pending()).toBe(0);
  });
});
