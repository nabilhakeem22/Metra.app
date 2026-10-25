// The section-title combobox: its list is drawn in a layer on <body> (so the
// next glass card can never paint over it), and the keyboard, pointer and
// focus behaviour is the field's own: the input keeps focus throughout.
import * as Dialog from '@radix-ui/react-dialog';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SectionCombobox, type SectionOption } from './section-combobox';

afterEach(cleanup);

const LIBRARY: SectionOption[] = [
  { id: 'civil', nameEn: 'Civil works', nameAr: 'أعمال مدنية' },
  { id: 'paint', nameEn: 'Painting', nameAr: 'دهانات' },
  { id: 'gypsum', nameEn: 'Gypsum', nameAr: 'جبس' },
];

function renderField(locale = 'en', onChange = vi.fn(), onCreate = vi.fn()) {
  function Field() {
    const [titles, setTitles] = useState({ titleEn: '', titleAr: '' });
    return (
      <SectionCombobox
        locale={locale}
        valueEn={titles.titleEn}
        valueAr={titles.titleAr}
        options={LIBRARY}
        onCreate={onCreate}
        onChange={(patch) => {
          onChange(patch);
          setTitles(patch);
        }}
      />
    );
  }
  const view = render(
    <div data-card="">
      <Field />
    </div>,
  );
  return { ...view, onChange, onCreate };
}

const input = () => screen.getByRole('combobox');
const press = (key: string, init: Partial<KeyboardEventInit> = {}) => fireEvent.keyDown(input(), { key, ...init });
const selected = () => screen.getAllByRole('option').findIndex((option) => option.getAttribute('aria-selected') === 'true');

describe('SectionCombobox layer', () => {
  it('draws the list in a layer on <body>, outside the card, and names it from the input', () => {
    const { container } = renderField();
    fireEvent.focus(input());
    const list = screen.getByRole('listbox');
    expect(container.contains(list)).toBe(false);
    const layer = list.closest('[data-anchored-layer]') as HTMLElement;
    expect(layer.parentElement).toBe(document.body);
    expect(layer.className).toContain('fixed');
    expect(layer.style.pointerEvents).toBe('auto');
    expect(input().getAttribute('aria-controls')).toBe(list.id);
    expect(input().getAttribute('aria-expanded')).toBe('true');
  });

  it('takes the direction of the field, so it starts on the field\'s start edge in Arabic', () => {
    renderField('ar-EG');
    fireEvent.focus(input());
    expect((screen.getByRole('listbox').closest('[data-anchored-layer]') as HTMLElement).dir).toBe('rtl');
    expect(screen.getAllByRole('option')[0].textContent).toBe('أعمال مدنية');
  });
});

describe('SectionCombobox keyboard', () => {
  it('arrows move the active option and Enter picks it, filling both titles', () => {
    const { onChange } = renderField();
    fireEvent.focus(input());
    expect(selected()).toBe(0);
    press('ArrowDown');
    press('ArrowDown');
    expect(selected()).toBe(2);
    press('ArrowDown');
    expect(selected()).toBe(2);
    press('ArrowUp');
    expect(selected()).toBe(1);
    press('Enter');
    expect(onChange).toHaveBeenLastCalledWith({ titleEn: 'Painting', titleAr: 'دهانات' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape closes the list; ArrowDown opens it again', () => {
    renderField();
    fireEvent.focus(input());
    press('Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input().getAttribute('aria-expanded')).toBe('false');
    press('ArrowDown');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('Tab closes the list and is not swallowed, so focus moves on to the next field', () => {
    renderField();
    fireEvent.focus(input());
    const tab = fireEvent.keyDown(input(), { key: 'Tab' });
    expect(tab).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('typing filters in either language and a new name is offered to the library on Enter', () => {
    const { onCreate } = renderField();
    fireEvent.change(input(), { target: { value: 'gyp' } });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Gypsum']);
    fireEvent.change(input(), { target: { value: 'Joinery' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    press('Enter');
    expect(onCreate).toHaveBeenCalledWith({ nameEn: 'Joinery', nameAr: null });
  });
});

describe('SectionCombobox pointer', () => {
  it('a press on a row keeps the input focused and picks nothing; the click picks', () => {
    const { onChange } = renderField();
    input().focus();
    fireEvent.focus(input());
    const row = screen.getAllByRole('option')[1].querySelector('button') as HTMLButtonElement;
    expect(row.tabIndex).toBe(-1);
    fireEvent.pointerDown(row);
    const mouseDownAllowed = fireEvent.mouseDown(row);
    expect(mouseDownAllowed).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledWith({ titleEn: 'Painting', titleAr: 'دهانات' });
    expect(document.activeElement).toBe(input());
  });

  it('a press outside both the field and its layer closes the list', () => {
    renderField();
    fireEvent.focus(input());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('SectionCombobox inside a modal dialog', () => {
  // A modal dialog turns pointer events off on <body>; the layer turns them back
  // on, and is reached through the React tree, so a row still picks. (Whether
  // the press dismisses the dialog is Radix's own outside-press test, which
  // happy-dom does not run; it reads the React tree, which the layer is in.)
  it('the body-level layer sits outside the dialog yet takes the pointer, and a row picks', () => {
    const onChange = vi.fn();
    render(
      <Dialog.Root open>
        <Dialog.Portal>
          <Dialog.Content aria-describedby={undefined}>
            <Dialog.Title>Sheet</Dialog.Title>
            <SectionCombobox locale="en" valueEn="" valueAr="" options={LIBRARY} onCreate={vi.fn()} onChange={onChange} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>,
    );
    fireEvent.focus(input());
    const layer = screen.getByRole('listbox').closest('[data-anchored-layer]') as HTMLElement;
    expect(screen.getByRole('dialog').contains(layer)).toBe(false);
    expect(layer.style.pointerEvents).toBe('auto');
    const row = screen.getAllByRole('option')[0].querySelector('button') as HTMLButtonElement;
    fireEvent.pointerDown(row);
    fireEvent.mouseDown(row);
    fireEvent.click(row);
    expect(onChange).toHaveBeenCalledWith({ titleEn: 'Civil works', titleAr: 'أعمال مدنية' });
  });
});

describe('SectionCombobox list id', () => {
  it('is the same in every server render, so aria-controls survives hydration', () => {
    const field = () => <SectionCombobox locale="en" valueEn="" valueAr="" options={LIBRARY} onCreate={() => {}} onChange={() => {}} />;
    const controls = (html: string) => /aria-controls="([^"]+)"/.exec(html)?.[1];
    const first = controls(renderToString(field()));
    expect(first).toBeTruthy();
    expect(controls(renderToString(field()))).toBe(first);
  });
});
