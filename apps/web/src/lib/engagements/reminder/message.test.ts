import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next-intl/server', () => ({ getLocale: vi.fn() }));

import { reminderMessages } from './message';

const DASH = /[–—]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;

const recipient = {
  client: { nameAr: 'أحمد', nameEn: 'Ahmed' },
  studio: { nameAr: null, nameEn: 'Diwan Studio' },
  defaultLocale: 'ar-EG' as const,
  phone: null,
  email: null,
};

describe('reminderMessages', () => {
  const messages = reminderMessages({ origin: 'https://metra.app', rawToken: 'tok_-1', recipient });

  it('carries the EXISTING link, in each message its own language', () => {
    expect(messages['ar-EG']).toContain('https://metra.app/ar-EG/d/tok_-1');
    expect(messages.en).toContain('https://metra.app/en/d/tok_-1');
  });

  it('names the client and the studio by locale, falling back to the other language', () => {
    expect(messages['ar-EG']).toContain('أحمد');
    expect(messages.en).toContain('Ahmed');
    expect(messages['ar-EG']).toContain('Diwan Studio');
  });

  it('has no dash and no Arabic-Indic digit', () => {
    for (const message of Object.values(messages)) {
      expect(message).not.toMatch(DASH);
      expect(message).not.toMatch(ARABIC_INDIC_DIGIT);
    }
  });
});
