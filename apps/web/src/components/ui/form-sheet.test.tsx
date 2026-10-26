import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { messagesFor, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { FormField } from './form-field';
import { FormSheet } from './form-sheet';

function renderSheet(overrides: Partial<Parameters<typeof FormSheet>[0]> = {}) {
  const onSubmit = vi.fn();
  const onOpenChange = vi.fn();
  renderWithIntl(
    <FormSheet
      open
      onOpenChange={onOpenChange}
      title="New client"
      onSubmit={onSubmit}
      submitLabel="Save"
      cancelLabel="Cancel"
      closeLabel="Close"
      pending={false}
      {...overrides}
    >
      <FormField id="name" label="Name" required hint={<FieldHint hint="Their legal name" />}>
        <Input />
      </FormField>
      <FormField id="phone" label="Phone">
        <Input />
      </FormField>
    </FormSheet>,
    { locale: 'en' },
  );
  return { onSubmit, onOpenChange };
}

describe('FormSheet', () => {
  test('submitting the form (what Enter in a field does) calls onSubmit once', () => {
    const { onSubmit } = renderSheet();
    const name = screen.getByRole('textbox', { name: /Name/ });
    fireEvent.submit(name.closest('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('Save stays enabled with every field empty: pressing it is how the errors appear', () => {
    renderSheet();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  test('pending blocks a second submit and disables Save', () => {
    const { onSubmit } = renderSheet({ pending: true });
    fireEvent.submit(screen.getByRole('textbox', { name: /Name/ }).closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('a close button closes it, and Cancel does too', async () => {
    const { onOpenChange } = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await act(async () => {});
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('while a save is pending nothing closes it: Cancel and the close button are disabled, Escape does nothing (H7.3 F3)', async () => {
    const { onOpenChange } = renderSheet({ pending: true });
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await act(async () => {});
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test('once the save has answered, Escape closes it again', async () => {
    const { onOpenChange } = renderSheet();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await act(async () => {});
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test('on close, focus goes where onCloseAutoFocus puts it: a sheet opened without a trigger has none (H7.3 F4)', async () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    let calls = 0;
    const returnFocus = (event: Event) => {
      calls += 1;
      event.preventDefault();
      trigger.focus();
    };
    const sheet = renderWithIntl(
      <FormSheet open onOpenChange={() => {}} title="New client" onSubmit={() => {}} submitLabel="Save" cancelLabel="Cancel" closeLabel="Close" pending={false} onCloseAutoFocus={returnFocus}>
        <Input />
      </FormSheet>,
      { locale: 'en' },
    );
    await act(async () => {});
    sheet.unmount();
    await act(async () => new Promise((done) => setTimeout(done, 0)));
    expect(calls).toBe(1);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  test('opening focuses the first field, not the hint button beside its label', async () => {
    renderSheet();
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: /Name/ }));
  });

  test('a form-level refusal is announced above the footer', () => {
    renderSheet({ formError: 'Something went wrong' });
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong');
  });
});

/** Three fields; the ones named in `errors` are refused. */
function RefusedSheet({ errors, attempt }: { errors: Record<string, string>; attempt: number }) {
  return (
    <FormSheet
      open
      onOpenChange={() => {}}
      title="New client"
      onSubmit={() => {}}
      submitLabel="Save"
      cancelLabel="Cancel"
      closeLabel="Close"
      pending={false}
      invalidAttempt={attempt}
    >
      {['name', 'phone', 'city'].map((id) => (
        <FormField key={id} id={id} label={id} error={errors[id]}>
          <Input />
        </FormField>
      ))}
    </FormSheet>
  );
}

/** Rendered so that a rerender keeps the catalogue (renderWithIntl's would not). */
function renderInLocale(ui: ReactNode, locale: TestLocale) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
  return render(ui, { wrapper });
}

describe.each<TestLocale>(['en', 'ar-EG'])('FormSheet focus on refusal (%s)', (locale) => {
  test('a new invalid attempt focuses the first refused field in DOM order', async () => {
    const view = renderInLocale(<RefusedSheet errors={{}} attempt={0} />, locale);
    await act(async () => {});
    expect(document.activeElement?.id).toBe('name');

    view.rerender(<RefusedSheet errors={{ city: 'c', phone: 'p' }} attempt={1} />);
    expect(document.activeElement?.id).toBe('phone');
  });

  test('without a new attempt focus does not move', async () => {
    const view = renderInLocale(<RefusedSheet errors={{ city: 'c' }} attempt={1} />, locale);
    await act(async () => {});
    (document.getElementById('name') as HTMLInputElement).focus();
    view.rerender(<RefusedSheet errors={{ city: 'c', phone: 'p' }} attempt={1} />);
    expect(document.activeElement?.id).toBe('name');
  });
});
