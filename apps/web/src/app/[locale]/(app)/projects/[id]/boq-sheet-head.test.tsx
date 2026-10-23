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
});
