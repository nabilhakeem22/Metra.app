import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { stepsForPage, TOUR_STEPS } from './tour-steps';

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

describe('TOUR_STEPS', () => {
  it('walks welcome, clients, projects, then deliveries, ending on the new-delivery button', () => {
    expect(TOUR_STEPS.map((step) => step.id)).toEqual(['welcome', 'clients', 'projects', 'deliveries']);
    expect(TOUR_STEPS.at(-1)).toMatchObject({ page: '/engagements', anchor: 'engagements-new' });
    expect(stepsForPage('/engagements/').map((step) => step.id)).toEqual(['deliveries']);
  });

  it('every step has its title and body in both catalogs', () => {
    for (const step of TOUR_STEPS) {
      for (const key of [step.titleKey, step.bodyKey]) {
        expect(typeof lookup(en, key), `en ${key}`).toBe('string');
        expect(typeof lookup(ar, key), `ar ${key}`).toBe('string');
      }
    }
  });
});
