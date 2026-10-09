import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';

// Client-page copy rules no key-level gate can see.

function clientValues(bundle: unknown, path = ''): Array<[string, string]> {
  if (typeof bundle === 'string') return [[path, bundle]];
  if (typeof bundle !== 'object' || bundle === null) return [];
  return Object.entries(bundle).flatMap(([key, value]) => clientValues(value, path ? `${path}.${key}` : key));
}

describe('client page copy', () => {
  it('F6: one register for requests: no «برجاء» anywhere on the client page', () => {
    const offenders = clientValues(ar.delivery, 'delivery')
      .filter(([key]) => !key.startsWith('delivery.share.'))
      .filter(([, value]) => value.includes('برجاء'));
    expect(offenders).toEqual([]);
  });

  it('F8: the design approval dialog and its confirmation name the same next step', () => {
    const design = { en: en.delivery.hero.design, ar: ar.delivery.hero.design };
    for (const key of ['confirmBody', 'approvedBody', 'approvedBodyNotified'] as const) {
      expect(design.en[key]).toContain('drawings for execution');
      expect(design.ar[key]).toContain('رسومات التنفيذ');
    }
  });
});
