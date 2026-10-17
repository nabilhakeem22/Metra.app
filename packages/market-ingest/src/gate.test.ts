import { describe, expect, it } from 'vitest';
import { readGate, requireCleanGate } from './gate';

const COMMIT = 'a'.repeat(40);

describe('the gate integrity check (S2)', () => {
  it('reads this checkout: a 40-character commit', () => {
    expect(readGate().commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns the commit of a clean gate', () => {
    expect(requireCleanGate({ commit: COMMIT, changedFiles: [] }, 'market:publish')).toBe(COMMIT);
  });

  it('refuses a gate whose code differs from the commit, naming the files', () => {
    expect(() => requireCleanGate({ commit: COMMIT, changedFiles: ['packages/market-ingest/src/check/slots.ts'] }, 'market:publish'))
      .toThrow('market:publish refuses: the gate code differs from commit aaaaaaaaaaaa (packages/market-ingest/src/check/slots.ts)');
  });

  it('refuses outside a git checkout', () => {
    expect(() => requireCleanGate({ commit: null, changedFiles: [] }, 'market:review')).toThrow('runs only from a git checkout');
  });
});
