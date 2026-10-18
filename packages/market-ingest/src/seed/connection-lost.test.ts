import { describe, expect, it } from 'vitest';
import { isConnectionLost } from './connection-lost';

describe('a connection lost under a seed run', () => {
  it('is a terminated backend, a closed or reset socket, or class 08, under a drizzle wrapper or bare', () => {
    const terminated = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });
    expect(isConnectionLost(Object.assign(new Error('Failed query: insert ...'), { cause: terminated }))).toBe(true);
    expect(isConnectionLost(Object.assign(new Error('write CONNECTION_CLOSED'), { code: 'CONNECTION_CLOSED' }))).toBe(true);
    expect(isConnectionLost(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isConnectionLost(Object.assign(new Error('connection failure'), { code: '08006' }))).toBe(true);
  });

  it('is not a refusal of the studio itself', () => {
    expect(isConnectionLost(Object.assign(new Error('lock timeout'), { code: '55P03' }))).toBe(false);
    expect(isConnectionLost(Object.assign(new Error('duplicate'), { code: '23505' }))).toBe(false);
    expect(isConnectionLost(new Error('no organization x'))).toBe(false);
  });
});
