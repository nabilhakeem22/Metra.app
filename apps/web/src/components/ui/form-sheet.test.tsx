import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { renderWithIntl } from '@/test/render-with-intl';
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

  test('a submit is ignored while it cannot submit, or while pending', () => {
    const blocked = renderSheet({ canSubmit: false });
    fireEvent.submit(screen.getByRole('textbox', { name: /Name/ }).closest('form')!);
    expect(blocked.onSubmit).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });

  test('pending blocks a second submit', () => {
    const { onSubmit } = renderSheet({ pending: true });
    fireEvent.submit(screen.getByRole('textbox', { name: /Name/ }).closest('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
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

describe('FormField', () => {
  test('marks the field required and points it at its error', () => {
    renderWithIntl(
      <FormField id="title" label="Title" required error="Enter a title">
        <Input />
      </FormField>,
      { locale: 'en' },
    );
    const input = screen.getByRole('textbox');
    expect(input.id).toBe('title');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('title-error');
    expect(document.getElementById('title-error')?.textContent).toBe('Enter a title');
  });

  test('without an error the field is not invalid and describes only its hint', () => {
    renderWithIntl(
      <FormField id="email" label="Email" hint="We send receipts here">
        <Input />
      </FormField>,
      { locale: 'en' },
    );
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe('email-hint');
    expect(document.getElementById('email-hint')?.textContent).toBe('We send receipts here');
  });

  test('keeps a description the control already carries', () => {
    render(<span id="outside">outside</span>);
    renderWithIntl(
      <FormField id="code" label="Code" error="Taken">
        <Input aria-describedby="outside" />
      </FormField>,
      { locale: 'en' },
    );
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe('outside code-error');
  });
});
