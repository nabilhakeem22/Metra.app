import { describe, expect, it } from 'vitest';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { messageAt, type TestLocale } from '@/test/render-with-intl';
import { deliveryMetadata } from './delivery-metadata';

// F3: the client page's tab title and link preview are the delivery's own words
// in the client's register, never the studio app's marketing copy.

const translator = (locale: TestLocale) => (key: string, values?: Record<string, string>) =>
  Object.entries(values ?? {}).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, value),
    messageAt(locale, `delivery.${key}`),
  );

const DELIVERY = {
  firm: { nameAr: 'ديوان', nameEn: 'Diwan Studio', logoFileId: null },
  client: { nameAr: 'أحمد', nameEn: 'Ahmed' },
  titleAr: 'شقة الزمالك',
  titleEn: 'Zamalek flat',
} as unknown as PublicDelivery;

describe('deliveryMetadata', () => {
  it.each([
    ['ar-EG', 'شقة الزمالك · ديوان', 'ديوان'],
    ['en', 'Zamalek flat · Diwan Studio', 'Diwan Studio'],
  ] as const)('%s: project and studio, in the page language', (locale, title, firm) => {
    const metadata = deliveryMetadata({ status: 'ok', delivery: DELIVERY }, locale, translator(locale));
    expect(metadata.title).toEqual({ absolute: title });
    expect(metadata.description).toBe(messageAt(locale, 'delivery.meta.description').replace('{firm}', firm));
    expect(metadata.robots).toEqual({ index: false, follow: false });
    // Not the studio app's marketing copy.
    expect(JSON.stringify(metadata)).not.toContain(messageAt(locale, 'meta.description'));
  });

  it('with no project title it is the studio alone', () => {
    const metadata = deliveryMetadata({ status: 'ok', delivery: { ...DELIVERY, titleAr: null, titleEn: null } }, 'en', translator('en'));
    expect(metadata.title).toEqual({ absolute: 'Diwan Studio' });
  });

  it.each([
    ['not_found', 'notFound'],
    ['read_failed', 'readFailed'],
  ] as const)('%s: the notice, in فصحى', (status, notice) => {
    const metadata = deliveryMetadata({ status }, 'ar-EG', translator('ar-EG'));
    expect(metadata.title).toEqual({ absolute: messageAt('ar-EG', `delivery.${notice}.title`) });
    expect(metadata.description).toBe(messageAt('ar-EG', `delivery.${notice}.body`));
  });
});
