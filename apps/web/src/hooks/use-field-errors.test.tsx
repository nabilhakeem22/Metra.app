import { act, fireEvent, screen } from '@testing-library/react';
import { useTranslations } from 'next-intl';
import { describe, expect, test } from 'vitest';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { fieldsFailed, type FieldErrors } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { useFieldErrors } from './use-field-errors';

const FIELDS = ['name', 'phone', 'city'] as const;
type Field = (typeof FIELDS)[number];

/** A sheet whose Save answers with whatever the test hands it. */
function Harness({
  answer,
  local,
}: {
  answer: () => ActionResult | Promise<ActionResult>;
  local?: FieldErrors<Field>;
}) {
  const te = useTranslations('errors');
  const errors = useFieldErrors({ fields: FIELDS, translate: te });
  async function submit() {
    if (local && errors.applyLocal(local)) return;
    // Every form starts a send this way: the edit record begins here.
    if (!local) errors.clear();
    try {
      errors.applyResult(await answer());
    } catch (rejection) {
      errors.applyRejection(rejection);
    }
  }
  return (
    <>
      <output data-testid="attempt">{errors.invalidAttempt}</output>
      <FormSheet
        open
        onOpenChange={() => {}}
        title="Client"
        onSubmit={() => void submit()}
        submitLabel="Save"
        cancelLabel="Cancel"
        closeLabel="Close"
        pending={false}
        formError={errors.formError}
        invalidAttempt={errors.invalidAttempt}
      >
        {FIELDS.map((field) => (
          <FormField key={field} id={field} label={field} {...errors.bind(field)}>
            <Input defaultValue="" />
          </FormField>
        ))}
      </FormSheet>
    </>
  );
}

async function save() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  });
}

const under = (id: string) => document.getElementById(`${id}-error`)?.textContent;

describe.each<TestLocale>(['en', 'ar-EG'])('useFieldErrors (%s)', (locale) => {
  const at = (key: string) => messageAt(locale, key);

  test('two field errors show under their fields, no form error, one more attempt', async () => {
    document.documentElement.dir = locale === 'ar-EG' ? 'rtl' : 'ltr';
    renderWithIntl(
      <Harness
        answer={() =>
          fieldsFailed({ phone: { code: 'phone_required' }, city: { code: 'too_long', params: { max: 120 } } })
        }
      />,
      { locale },
    );
    await save();
    expect(under('phone')).toBe(at('errors.phone_required'));
    expect(under('city')).toBe(at('errors.field.too_long').replace('{max}', '120'));
    expect(under('name')).toBeUndefined();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('attempt').textContent).toBe('1');
    expect(document.activeElement?.id).toBe('phone');
  });

  test('a path the form does not render is said above the footer, never dropped', async () => {
    renderWithIntl(
      <Harness answer={() => fieldsFailed({ notes: { code: 'required' }, name: { code: 'name_required' } })} />,
      { locale },
    );
    await save();
    expect(screen.getByRole('alert').textContent).toBe(at('errors.field.required'));
    expect(under('name')).toBe(at('errors.name_required'));
  });

  test('editing one field clears its error and keeps the other', async () => {
    renderWithIntl(
      <Harness answer={() => fieldsFailed({ name: { code: 'required' }, phone: { code: 'required' } })} />,
      { locale },
    );
    await save();
    fireEvent.change(document.getElementById('name')!, { target: { value: 'Mona' } });
    expect(under('name')).toBeUndefined();
    expect(document.getElementById('name')!.getAttribute('aria-invalid')).toBeNull();
    expect(under('phone')).toBe(at('errors.field.required'));
  });

  test('a failure with no fields is the form error, with its reference', async () => {
    renderWithIntl(
      <Harness answer={() => ({ ok: false, error: 'generic', reference: 'K7Q29MXD' })} />,
      { locale },
    );
    await save();
    expect(screen.getByRole('alert').textContent).toBe(
      `${at('errors.generic')} ${at('errors.reference').replace('{reference}', 'K7Q29MXD')}`,
    );
    expect(screen.getByTestId('attempt').textContent).toBe('0');
  });

  test('a rejected action that never reached the server says so', async () => {
    renderWithIntl(
      <Harness
        answer={() => {
          throw new TypeError('fetch failed');
        }}
      />,
      { locale },
    );
    await save();
    expect(screen.getByRole('alert').textContent).toBe(at('errors.unreachable'));
  });

  test('a local pre-check refuses under the field without sending', async () => {
    let sent = 0;
    renderWithIntl(
      <Harness
        answer={() => {
          sent += 1;
          return { ok: true };
        }}
        local={{ city: { code: 'required' } }}
      />,
      { locale },
    );
    await save();
    expect(sent).toBe(0);
    expect(under('city')).toBe(at('errors.field.required'));
  });

  test('R6: an edit made while the save is in flight keeps its field clear, and the caret stays', async () => {
    let answerNow: (result: ActionResult) => void = () => {};
    renderWithIntl(<Harness answer={() => new Promise((resolve) => (answerNow = resolve))} />, { locale });
    await save();
    const city = document.getElementById('city') as HTMLInputElement;
    city.focus();
    fireEvent.change(city, { target: { value: 'Giza' } });
    const before = screen.getByTestId('attempt').textContent;
    await act(async () => {
      answerNow(fieldsFailed({ city: { code: 'required' }, name: { code: 'required' } }));
    });
    expect(under('city')).toBeUndefined();
    expect(under('name')).toBe(at('errors.field.required'));
    expect(screen.getByTestId('attempt').textContent).toBe(before);
    expect(document.activeElement).toBe(city);
  });
});
