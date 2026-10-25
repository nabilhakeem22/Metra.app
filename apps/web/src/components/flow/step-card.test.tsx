import { describe, expect, test } from 'vitest';
import { resolveCommandCardChrome } from '@/lib/engagements/command-card-chrome';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { StepCard, StepHeadline } from './step-card';

const LOCALES: TestLocale[] = ['ar-EG', 'en'];

describe('StepCard', () => {
  test.each(LOCALES)('wears the status chrome, the rail in its band and the body, in %s', (locale) => {
    const chrome = resolveCommandCardChrome({ kind: 'yourMove' });
    const { container, getByText } = renderWithIntl(
      <div dir={locale === 'ar-EG' ? 'rtl' : 'ltr'}>
        <StepCard chrome={chrome} rail={<ol data-testid="rail" />}>
          <StepHeadline
            eyebrow={messageAt(locale, 'engagements.command.nextAction')}
            headline={messageAt(locale, 'engagements.spine.survey')}
            hint={messageAt(locale, 'engagements.command.pill.waitingClient')}
          />
        </StepCard>
      </div>,
      { locale },
    );
    const card = container.querySelector('section')!;
    expect(card.className).toContain(chrome.borderClass);
    // The stripe sits on the inline-START, so it mirrors to the right edge in ar-EG.
    const stripe = card.querySelector('span[aria-hidden]') as HTMLElement;
    expect(stripe.className).toContain(chrome.stripeClass);
    expect(stripe.style.insetInlineStart).toBe('0');
    expect(card.querySelector('[data-testid="rail"]')).not.toBeNull();
    expect(getByText(messageAt(locale, 'engagements.spine.survey')).tagName).toBe('H2');
    expect(getByText(messageAt(locale, 'engagements.command.nextAction'))).toBeTruthy();
  });

  test('leaves the eyebrow and the hint out when there are none', () => {
    const { container } = renderWithIntl(
      <StepHeadline eyebrow={null} headline={messageAt('ar-EG', 'engagements.spine.handover')} hint={null} />,
    );
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild?.tagName).toBe('H2');
  });
});
