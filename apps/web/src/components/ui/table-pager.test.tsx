import { screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { TablePager } from './table-pager';

const hrefFor = (page: number) => `/proposals?q=tile&page=${page}`;

/** A catalogue message with its {placeholders} filled, so no test types copy. */
function filled(locale: TestLocale, key: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, value),
    messageAt(locale, `common.pager.${key}`),
  );
}

function renderPager(page: number, total: number, locale: TestLocale = 'en', label?: string) {
  return renderWithIntl(
    <TablePager page={page} pageSize={25} total={total} hrefFor={hrefFor} label={label} />,
    { locale },
  );
}

/** The page numbers drawn from sm up, … for a gap. */
function drawnNumbers(): string {
  const list = document.querySelector('nav ol')!;
  return [...list.children].map((item) => item.textContent).join(' ');
}

describe('TablePager', () => {
  test('a single page, or none, renders nothing', () => {
    expect(renderPager(1, 25).container.innerHTML).toBe('');
    expect(renderPager(1, 0).container.innerHTML).toBe('');
  });

  test('the middle of twelve pages: range, numbers with gaps, the current page marked', () => {
    renderPager(5, 290);
    expect(screen.getByText(filled('en', 'range', { from: '101', to: '125', total: '290' }))).toBeTruthy();
    expect(screen.getByText(filled('en', 'pageOf', { page: '5', pageCount: '12' }))).toBeTruthy();
    expect(drawnNumbers()).toBe('1 … 4 5 6 … 12');

    const current = screen.getByRole('link', { name: filled('en', 'page', { page: '5' }) });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(document.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(screen.getByRole('link', { name: filled('en', 'page', { page: '12' }) }).getAttribute('href')).toContain(
      '/proposals?q=tile&page=12',
    );
  });

  test('Previous and Next are real links either side, carrying the filters', () => {
    renderPager(5, 290);
    const previous = screen.getByRole('link', { name: messageAt('en', 'common.pager.previous') });
    const next = screen.getByRole('link', { name: messageAt('en', 'common.pager.next') });
    expect(previous.getAttribute('rel')).toBe('prev');
    expect(previous.getAttribute('href')).toContain('/proposals?q=tile&page=4');
    expect(next.getAttribute('rel')).toBe('next');
    expect(next.getAttribute('href')).toContain('/proposals?q=tile&page=6');
  });

  test('the first page has no Previous', () => {
    renderPager(1, 60);
    expect(screen.queryByRole('link', { name: messageAt('en', 'common.pager.previous') })).toBeNull();
    expect(screen.getByRole('link', { name: messageAt('en', 'common.pager.next') })).toBeTruthy();
    expect(drawnNumbers()).toBe('1 2 3');
  });

  test('the last page has no Next, and its range ends at the total', () => {
    renderPager(3, 60);
    expect(screen.queryByRole('link', { name: messageAt('en', 'common.pager.next') })).toBeNull();
    expect(screen.getByText(filled('en', 'range', { from: '51', to: '60', total: '60' }))).toBeTruthy();
  });

  test('a page past the end is drawn as the last page', () => {
    renderPager(40, 60);
    expect(screen.getByText(filled('en', 'range', { from: '51', to: '60', total: '60' }))).toBeTruthy();
    expect(screen.queryByRole('link', { name: messageAt('en', 'common.pager.next') })).toBeNull();
  });

  test('below sm only Previous, "Page X of Y" and Next show; the range and numbers are sm-up', () => {
    renderPager(2, 100);
    const range = screen.getByText(filled('en', 'range', { from: '26', to: '50', total: '100' }));
    expect(range.className).toMatch(/(^| )hidden( |$)/);
    expect(range.className).toContain('sm:block');
    expect(document.querySelector('nav ol')!.className).toMatch(/(^| )hidden( |$)/);
    expect(screen.getByText(filled('en', 'pageOf', { page: '2', pageCount: '4' })).className).toContain('sm:hidden');
  });

  test('the caller names the navigation, or it is "Pages"', () => {
    renderPager(2, 100, 'en', 'Proposal pages');
    expect(screen.getByRole('navigation', { name: 'Proposal pages' })).toBeTruthy();
  });

  test('ar-EG: Western digits, flipped chevrons, its own label', () => {
    renderPager(2, 1_234, 'ar-EG');
    expect(screen.getByRole('navigation', { name: messageAt('ar-EG', 'common.pager.label') })).toBeTruthy();
    expect(screen.getByText(filled('ar-EG', 'range', { from: '26', to: '50', total: '1,234' }))).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/[٠-٩۰-۹]/);
    const chevrons = document.querySelectorAll('nav svg');
    expect(chevrons).toHaveLength(2);
    for (const chevron of chevrons) {
      expect(chevron.getAttribute('class')).toContain('rtl:-scale-x-100');
      expect(chevron.getAttribute('aria-hidden')).toBe('true');
    }
  });
});
