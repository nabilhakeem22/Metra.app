import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { Textarea } from '@/components/ui/textarea';
import { renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { FormField } from './form-field';

describe.each<TestLocale>(['en', 'ar-EG'])('FormField (%s)', (locale) => {
  test('the refusal sits under its control, described, with no role', () => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(
      <FormField id="f" label="Title" required error="m">
        <Input />
      </FormField>,
      { locale },
    );
    const input = screen.getByRole('textbox');
    const error = document.getElementById('f-error')!;
    expect(input.id).toBe('f');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain('f-error');
    expect(error.textContent).toBe('m');
    expect(error.hasAttribute('role')).toBe(false);
    expect(input.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('FormField', () => {
  test('a group of controls is named by its label through aria-labelledby, never a <label> pointing at it (H7.3 F6)', () => {
    renderWithIntl(
      <FormField id="answer" label="The answer" required group error="Pick one">
        <div role="radiogroup" tabIndex={-1}>
          <label>
            <input type="radio" name="answer" value="yes" /> Yes
          </label>
        </div>
      </FormField>,
      { locale: 'en' },
    );
    const group = screen.getByRole('radiogroup', { name: /The answer/ });
    expect(group.id).toBe('answer');
    expect(document.querySelector('label[for="answer"]')).toBeNull();
    expect(document.getElementById(group.getAttribute('aria-labelledby')!)?.textContent).toContain('The answer');
    expect(group.getAttribute('aria-invalid')).toBe('true');
    expect(group.getAttribute('aria-required')).toBe('true');
    expect(group.getAttribute('aria-describedby')).toBe('answer-error');
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
    expect(document.getElementById('email-error')).toBeNull();
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

  test('one change on an Input runs onEdit once, then the input own handler once', () => {
    const calls: string[] = [];
    renderWithIntl(
      <FormField id="phone" label="Phone" onEdit={() => calls.push('edit')}>
        <Input onChange={(event) => calls.push(`own:${event.target.value}`)} />
      </FormField>,
      { locale: 'en' },
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '0100' } });
    expect(calls).toEqual(['edit', 'own:0100']);
  });

  test('one change on a Textarea runs onEdit once and its own handler once', () => {
    const onEdit = vi.fn();
    const own = vi.fn();
    renderWithIntl(
      <FormField id="notes" label="Notes" onEdit={onEdit}>
        <Textarea onChange={own} />
      </FormField>,
      { locale: 'en' },
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledTimes(1);
  });

  test('one pick on a SelectControl runs onEdit once and its onValueChange once', async () => {
    const onEdit = vi.fn();
    const own = vi.fn();
    renderWithIntl(
      <FormField id="unit" label="Unit" onEdit={onEdit}>
        <SelectControl
          value=""
          onValueChange={own}
          options={[
            { value: 'm2', label: 'm2' },
            { value: 'pc', label: 'pc' },
          ]}
        />
      </FormField>,
      { locale: 'en' },
    );
    const trigger = screen.getByRole('combobox');
    expect(trigger.id).toBe('unit');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    await act(async () => {});
    fireEvent.click(screen.getByRole('option', { name: 'pc' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledTimes(1);
    expect(own).toHaveBeenCalledWith('pc');
  });

  test('without onEdit the child handler is untouched', () => {
    const own = vi.fn();
    renderWithIntl(
      <FormField id="city" label="City">
        <Input onChange={own} />
      </FormField>,
      { locale: 'en' },
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Giza' } });
    expect(own).toHaveBeenCalledTimes(1);
  });
});
