import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import ar from '@/messages/ar-EG.json';
import { ENDING_TRIGGERS } from './forward-trigger';
import { TERMINAL_STATES } from './states';
import type { WhoseMove } from './whose-move';

// Keys the UI builds at runtime (`t(\`kinds.${x}\`)`). Parity passes when a key is
// absent from BOTH catalogs, and the browser then throws MISSING_MESSAGE, so each
// dynamic family is walked here against both bundles (as stage-action.test does).

function lookup(bundle: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[segment]
          : undefined,
      bundle,
    );
}

function expectInBothCatalogs(path: string): void {
  for (const [name, bundle] of [
    ['en', en],
    ['ar-EG', ar],
  ] as const) {
    const value = lookup(bundle, path);
    expect(typeof value, `${name} · ${path}`).toBe('string');
    expect((value as string).length, `${name} · ${path}`).toBeGreaterThan(0);
  }
}

/** Total over the union, so a new WhoseMove fails to compile until it is listed. */
const WHOSE_MOVES: Record<WhoseMove, true> = {
  studio: true,
  client: true,
  confirmPayment: true,
  closed: true,
};

describe('dynamic engagement copy keys exist in both catalogs', () => {
  it.each([...ENDING_TRIGGERS])('ending %s: cta, confirm title and body', (trigger) => {
    for (const field of ['cta', 'confirmTitle', 'confirmBody']) {
      expectInBothCatalogs(`engagements.command.ending.${trigger}.${field}`);
    }
  });

  it.each([...TERMINAL_STATES])('closed %s: a headline', (state) => {
    expectInBothCatalogs(`engagements.command.closed.${state}.headline`);
  });

  it.each(Object.keys(WHOSE_MOVES))('whose move %s', (whoseMove) => {
    expectInBothCatalogs(`engagements.whoseMove.${whoseMove}`);
  });
});
