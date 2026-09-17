// insertLinesInChunks opens no connection of its own — it issues statements on the
// transaction it is handed — so a recording stand-in for that transaction proves
// the only thing the function decides: how many statements, carrying which rows.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { MetraDb } from '@metra/db';
import type { PgTable } from 'drizzle-orm/pg-core';
import { insertLinesInChunks } from './insert-chunked';
import { LINE_INSERT_CHUNK } from './limits';

interface RecordedInsert {
  table: unknown;
  rows: unknown[];
}

function recordingTransaction(): { tx: MetraDb; inserts: RecordedInsert[] } {
  const inserts: RecordedInsert[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (rows: unknown[]) => {
        inserts.push({ table, rows });
        return Promise.resolve();
      },
    }),
  } as unknown as MetraDb;
  return { tx, inserts };
}

const fakeTable = { name: 'proposal_lines' } as unknown as PgTable;
const rowsOf = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ sortOrder: index }));

describe('insertLinesInChunks', () => {
  it('issues NO statement at all for an empty list', () => {
    // A document saved with zero lines must not send an `insert ... values ()`.
    const { tx, inserts } = recordingTransaction();
    return insertLinesInChunks(tx, fakeTable, rowsOf(0)).then(() => {
      expect(inserts).toEqual([]);
    });
  });

  it('sends one statement when the list fits in a single batch', async () => {
    const { tx, inserts } = recordingTransaction();
    await insertLinesInChunks(tx, fakeTable, rowsOf(2));
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe(fakeTable);
    expect(inserts[0].rows).toEqual([{ sortOrder: 0 }, { sortOrder: 1 }]);
  });

  it('splits at exactly LINE_INSERT_CHUNK and keeps the remainder', async () => {
    // The bind-parameter ceiling is the reason this function exists; the boundary
    // is the one number worth pinning. 501 rows is two statements, not one.
    const { tx, inserts } = recordingTransaction();
    await insertLinesInChunks(tx, fakeTable, rowsOf(LINE_INSERT_CHUNK + 1));
    expect(inserts.map((i) => i.rows.length)).toEqual([LINE_INSERT_CHUNK, 1]);
  });

  it('sends exactly one statement at the batch size, not two', async () => {
    const { tx, inserts } = recordingTransaction();
    await insertLinesInChunks(tx, fakeTable, rowsOf(LINE_INSERT_CHUNK));
    expect(inserts.map((i) => i.rows.length)).toEqual([LINE_INSERT_CHUNK]);
  });

  it('preserves order and loses no row across the batches', async () => {
    // A full 2,000-line import: line 1,499 must still be the 1,499th row written,
    // because `sortOrder` is assigned before the split and read back after it.
    //
    // This case is also what `concurrency-gates.dbtest.ts` used to be asking when
    // it timed a 2,000-line save against a 15-second wall clock (W3-6): the
    // invariant it wanted was "the insert is still batched", which is decided
    // here, with no database and no clock.
    const { tx, inserts } = recordingTransaction();
    await insertLinesInChunks(tx, fakeTable, rowsOf(2000));
    expect(inserts).toHaveLength(Math.ceil(2000 / LINE_INSERT_CHUNK));
    expect(inserts).toHaveLength(4);
    const written = inserts.flatMap((i) => i.rows);
    expect(written).toHaveLength(2000);
    expect(written[1498]).toEqual({ sortOrder: 1498 });
  });
});
