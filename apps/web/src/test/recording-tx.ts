// TEST-ONLY. A transaction double that RECORDS: every awaited statement lands in
// a journal as the builder calls it was made of, each argument rendered (tables,
// columns and SQL with its bound parameters), and resolves the next scripted
// result. It runs no query; what it proves is the statement text and its order.
import type { MetraDb } from '@metra/db';
import { Column, SQL, Table, getTableName, is } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

export interface RecordingTx {
  /** Pass to the withOrgContext double. NOT thenable itself. */
  tx: MetraDb;
  /** One entry per awaited statement, in await order, plus what tests push ('begin', 'end', 'audit ...'). */
  journal: string[];
  /** Queue the results the next awaited statements resolve with, in order. */
  respond(...results: unknown[]): void;
  /** How many queued results no statement consumed. */
  pending(): number;
  /** Clear journal and queue. */
  reset(): void;
  /** The renderer the journal uses (for audit entries). */
  render(value: unknown): string;
}

type Settle = (resolve: (result: unknown) => void, reject: (reason: Error) => void) => void;

const dialect = new PgDialect();

function hasGetSql(value: object): value is { getSQL(): unknown } {
  return typeof (value as { getSQL?: unknown }).getSQL === 'function';
}

function renderSql(value: SQL): string {
  const query = dialect.sqlToQuery(value);
  return `sql(${query.sql} ${JSON.stringify(query.params)})`;
}

function renderObject(value: object): string {
  if (value instanceof Date) return `Date(${value.toISOString()})`;
  if (is(value, Table)) return `table:${getTableName(value)}`;
  if (is(value, Column)) return `${getTableName(value.table)}.${value.name}`;
  if (is(value, SQL)) return renderSql(value);
  if (hasGetSql(value)) return render(value.getSQL());
  if (Array.isArray(value)) return `[${value.map(render).join(', ')}]`;
  return `{${Object.entries(value).map(([key, entry]) => `${key}: ${render(entry)}`).join(', ')}}`;
}

function render(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'object') return renderObject(value);
  if (typeof value === 'function') return '<function>';
  return String(value);
}

const renderCall = (name: string, args: unknown[]): string => `${name}(${args.map(render).join(', ')})`;

/** What one double has journalled, and the results its next statements resolve with. */
interface Script { journal: string[]; queue: unknown[] }

/** Reading a chain's `then` finishes the statement: journal it, take the next result. */
function finish(script: Script, parts: string[]): Settle {
  script.journal.push(parts.join('.'));
  if (script.queue.length === 0) return (_resolve, reject) => reject(new Error('recording-tx: no scripted result left'));
  const result = script.queue.shift();
  return (resolve) => resolve(result);
}

function startChain(script: Script, first: string): unknown {
  const parts = [first];
  const chain: unknown = new Proxy({}, {
    get(_target, property) {
      if (typeof property === 'symbol') return undefined;
      if (property === 'then') return finish(script, parts);
      return (...args: unknown[]) => {
        parts.push(renderCall(property, args));
        return chain;
      };
    },
  });
  return chain;
}

export function createRecordingTx(): RecordingTx {
  const script: Script = { journal: [], queue: [] };
  const tx = new Proxy({}, {
    get(_target, property) {
      if (typeof property === 'symbol' || property === 'then') return undefined;
      return (...args: unknown[]) => startChain(script, renderCall(property, args));
    },
  }) as unknown as MetraDb;
  return {
    tx,
    journal: script.journal,
    respond: (...results) => void script.queue.push(...results),
    pending: () => script.queue.length,
    reset: () => void (script.journal.length = script.queue.length = 0),
    render,
  };
}
