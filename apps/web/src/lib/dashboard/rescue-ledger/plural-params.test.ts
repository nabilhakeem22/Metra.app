import { describe, expect, it } from 'vitest';
import { pluralParams } from './plural-params';

describe('pluralParams', () => {
  it('hands ICU the number for the form and Latin digits for the reader, in both locales', () => {
    expect(pluralParams('paymentCount', 'paymentText', 1234, 'ar-EG')).toEqual({ paymentCount: 1234, paymentText: '1,234' });
    expect(pluralParams('count', 'countText', 12, 'en')).toEqual({ count: 12, countText: '12' });
  });
});
