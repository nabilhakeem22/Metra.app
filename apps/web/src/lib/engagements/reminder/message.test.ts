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

  it('R5: names are one capped line, the link stays intact on its own line', () => {
    const long = reminderMessages({
      origin: 'https://metra.app',
      rawToken: 'tok_-1',
      recipient: {
        ...recipient,
        client: { nameAr: null, nameEn: `Ahmed\r\n${'x'.repeat(500)}` },
        studio: { nameAr: null, nameEn: `Diwan\u202e${'y'.repeat(500)}` },
      },
    });
    const firstLine = long.en.split('\n')[0];
    expect(firstLine).not.toContain('\u202e');
    // Two names of at most 80 characters each, plus the sentence around them.
    expect(firstLine).not.toContain('x'.repeat(80));
    expect(Array.from(firstLine).length).toBeLessThan(320);
    expect(long.en.split('\n')[1]).toBe('https://metra.app/en/d/tok_-1');
  });

  it('F8: neutral, never claims the client has something to review', () => {
    expect(messages.en).not.toMatch(/review/i);
    expect(messages['ar-EG']).not.toContain('مراجعتك');
  });

  it('has no dash and no Arabic-Indic digit', () => {
    for (const message of Object.values(messages)) {
      expect(message).not.toMatch(DASH);
      expect(message).not.toMatch(ARABIC_INDIC_DIGIT);
    }
  });
});
