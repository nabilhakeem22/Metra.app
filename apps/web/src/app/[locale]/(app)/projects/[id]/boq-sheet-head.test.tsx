import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { BoqSheetHead } from './boq-sheet-head';

// The provisional column's header is a short word in the page's language (it
// was a Latin "P" on the Arabic sheet), and a tooltip says what it marks.

describe.each<TestLocale>(['en', 'ar-EG'])('the BOQ sheet header (%s)', (locale) => {
  test('the provisional column is headed in the page language, with its meaning on focus', async () => {
    renderWithIntl(
      <table>
        <BoqSheetHead canEdit={false} discounted={false} />
      </table>,
      { locale },
    );
    const short = messageAt(locale, 'projects.profile.boq.col.provisionalShort');
    expect(short).not.toBe('P');
    const header = screen.getByText(short);
    await act(async () => {
      fireEvent.focus(header);
    });
    expect((await screen.findAllByText(messageAt(locale, 'projects.profile.boq.col.provisionalHint'))).length).toBeGreaterThan(0);
  });

  test('the figure headers are LTR like their figures, so they sit over them on an Arabic sheet (F4)', () => {
    renderWithIntl(
      <table>
        <BoqSheetHead canEdit={false} discounted />
      </table>,
      { locale },
    );
    const headed = (key: string) => screen.getByText(messageAt(locale, `projects.profile.boq.col.${key}`)).closest('th');
    for (const figure of ['qty', 'rate', 'discount', 'total']) expect(headed(figure)?.getAttribute('dir')).toBe('ltr');
    for (const text of ['code', 'description', 'unit']) expect(headed(text)?.hasAttribute('dir')).toBe(false);
  });
});
