// The "From price book" picker driven by keyboard, pointer and screen reader:
// the active row is announced and scrolled to, Escape gives focus back, a
// reopened list starts at the top, a pointer picks on click only, and the
// list id is React's (stable on the server and the client).
import { fireEvent, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messageAt, messagesFor, renderWithIntl } from '@/test/render-with-intl';
import type { CostItemOption } from './builder-model';
import { PriceBookPicker } from './price-book-picker';
import type { SectionOption } from './section-combobox';

const server = vi.hoisted(() => ({ searchPriceBookPicker: vi.fn() }));
vi.mock('@/lib/price-book/picker-actions', () => server);

const SECTIONS: SectionOption[] = [{ id: 'glass', nameEn: 'Glass', nameAr: 'الزجاج' }];
const BOOK: CostItemOption[] = Array.from({ length: 8 }, (_, index) => ({
  id: `i${index}`,
  code: `MKT-i${index}`,
  sectionId: 'glass',
  nameEn: `Item ${index}`,
  nameAr: `بند ${index}`,
  unit: 'sqm',
  defaultUnitCost: '1',
  defaultUnitPrice: '1',
}));

const TRIGGER_NAME = messageAt('en', 'proposals.builder.fromPriceBook');
const trigger = () => screen.getByRole('button', { name: TRIGGER_NAME });
const combobox = () => screen.getByRole('combobox');
const press = (key: string) => fireEvent.keyDown(combobox(), { key });

let scrolled: Array<{ id: string; options: unknown }>;

beforeEach(() => {
  server.searchPriceBookPicker.mockResolvedValue({ ok: true, data: { items: BOOK, matched: BOOK.length } });
  scrolled = [];
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown) {
    scrolled.push({ id: this.id, options });
  };
});

afterEach(() => {
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

async function open() {
  const onPick = vi.fn();
  renderWithIntl(<PriceBookPicker sections={SECTIONS} onPick={onPick} />, { locale: 'en' });
  fireEvent.click(trigger());
  await screen.findAllByRole('option');
  return onPick;
}

describe('PriceBookPicker keyboard and screen reader (P2)', () => {
  it('names the active option on the input and scrolls it into view', async () => {
    await open();
    press('ArrowDown');
    press('ArrowDown');
    const third = screen.getAllByRole('option')[2];
    expect(third.id).not.toBe('');
    expect(combobox().getAttribute('aria-activedescendant')).toBe(third.id);
    expect(third.getAttribute('aria-selected')).toBe('true');
    expect(scrolled.at(-1)).toEqual({ id: third.id, options: { block: 'nearest' } });
  });

  it('Escape closes the list and gives focus back to the button', async () => {
    await open();
    expect(document.activeElement).toBe(combobox());
    press('Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('a reopened list starts at the first match, so Enter adds that one', async () => {
    const onPick = await open();
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    press('Escape');
    fireEvent.click(trigger());
    await screen.findAllByRole('option');
    const first = screen.getAllByRole('option')[0];
    expect(combobox().getAttribute('aria-activedescendant')).toBe(first.id);
    press('Enter');
    expect(onPick).toHaveBeenCalledWith(BOOK[0]);
    expect(document.activeElement).toBe(trigger());
  });
});

describe('PriceBookPicker pointer (P3)', () => {
  it('a touch or press that starts a scroll picks nothing; a click picks', async () => {
    const onPick = await open();
    const row = screen.getAllByRole('option')[1].querySelector('button') as HTMLButtonElement;
    fireEvent.touchStart(row);
    fireEvent.pointerDown(row);
    fireEvent.mouseDown(row);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(BOOK[1]);
  });
});

describe('PriceBookPicker list id (P4)', () => {
  const picker = () => (
    <NextIntlClientProvider locale="en" messages={messagesFor('en')} timeZone="UTC">
      <PriceBookPicker sections={SECTIONS} onPick={() => {}} />
    </NextIntlClientProvider>
  );

  it('the button controls the listbox it opens', async () => {
    await open();
    expect(trigger().getAttribute('aria-controls')).toBe(screen.getByRole('listbox').id);
  });

  it('the id is the same in every server render, so hydration matches', () => {
    const controls = (html: string) => /aria-controls="([^"]+)"/.exec(html)?.[1];
    const first = controls(renderToString(picker()));
    expect(first).toBeTruthy();
    expect(controls(renderToString(picker()))).toBe(first);
  });
});
