import { describe, expect, it } from 'vitest';
import { failureReason } from './failure';

describe('a failed studio line', () => {
  it('says the driver reason and SQLSTATE under a drizzle wrapper, never the query or params', () => {
    const driver = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03', detail: 'row data' });
    const wrapped = Object.assign(new Error('Failed query: insert into "cost_items" values ($1)\nparams: MKT-secret,41842.5000'), { cause: driver });
    const reason = failureReason(wrapped);
    expect(reason).toBe('SQLSTATE 55P03: canceling statement due to lock timeout');
    expect(reason).not.toMatch(/insert|params|MKT-secret|row data/);
  });

  it('keeps a plain error message, bounded', () => {
    expect(failureReason(new Error('no organization x'))).toBe('no organization x');
    expect(failureReason(new Error('x'.repeat(1000)))).toHaveLength(300);
  });

  it('never prints a wrapper query that carries no driver error', () => {
    expect(failureReason(new Error('Failed query: select 1\nparams: a'))).toBe('the database refused a statement (no SQLSTATE reached the client)');
  });
});
