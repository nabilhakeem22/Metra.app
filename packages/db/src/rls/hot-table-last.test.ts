import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { withoutSqlComments } from '../scripts/rls-catalogue';

// Round E (R1): apply-rls runs policies/40-engagements.sql as ONE implicit
// transaction, and each table it touches stays ACCESS EXCLUSIVE locked until the
// commit. design_engagements is the row every client write waits on (at most
// 4 s since 0060), so it must be the LAST table the file touches: then it is
// never held while the file waits on another table. Measured: a reader on
// engagement_events for 2.5 s held design_engagements for about 2,440 ms with
// it first, and 3 to 16 ms with it last.

const here = dirname(fileURLToPath(import.meta.url)); // packages/db/src/rls

/** Every `public.<table>` an ALTER, POLICY or TRIGGER statement names, in file order. */
function tablesTouched(sql: string): string[] {
  const statement = /\b(?:alter\s+table|on)\s+public\.(\w+)/gi;
  return [...withoutSqlComments(sql).matchAll(statement)].map((match) => match[1]);
}

describe('policies/40-engagements.sql touches design_engagements last (R1)', () => {
  it('no other table is named after the first design_engagements statement', () => {
    const tables = tablesTouched(readFileSync(resolve(here, 'policies/40-engagements.sql'), 'utf8'));
    const first = tables.indexOf('design_engagements');
    expect(first, 'design_engagements is in the file').toBeGreaterThan(-1);
    expect(tables.slice(first).filter((table) => table !== 'design_engagements')).toEqual([]);
    expect(new Set(tables.slice(0, first)).size).toBeGreaterThan(5);
  });
});
