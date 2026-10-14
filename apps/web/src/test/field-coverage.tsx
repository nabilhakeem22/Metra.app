import { screen } from '@testing-library/react';
import { expect } from 'vitest';
import { fieldErrorId } from '@/components/ui/field-error-text';
import { fieldsFailed, type FieldErrors } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';
import { messageAt, type TestLocale } from '@/test/render-with-intl';

// TEST-ONLY. The one assertion every migrated form makes (AC 19): a refusal
// for each of its fields lands UNDER that field's control, not in a toast and
// not in an alert, and the caret goes to the first one.

export interface FieldCoverageCase<F extends string> {
  /** The domain tuple the form renders. */
  fields: readonly F[];
  /** The DOM id of the control a field's refusal sits under. */
  controlIdOf: (field: F) => string;
  /** Make the mocked action answer with `result`. */
  answerWith: (result: ActionResult) => void;
  /** Press Save (and let the answer settle). */
  submit: () => Promise<void>;
  locale: TestLocale;
  /** 'errors' in the studio, 'portal.errors' on a client link page. */
  namespace?: 'errors' | 'portal.errors';
  /** Control id to the value typed before Save; still there after the refusal. */
  typed?: Readonly<Record<string, string>>;
}

function inDomOrder(elements: HTMLElement[]): HTMLElement[] {
  return [...elements].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

function expectUnderItsControl(controlId: string, message: string): HTMLElement {
  const control = document.getElementById(controlId);
  expect(control, `no control #${controlId}`).not.toBeNull();
  const refusal = document.getElementById(fieldErrorId(controlId));
  expect(refusal?.textContent, `no refusal under #${controlId}`).toBe(message);
  expect(refusal?.hasAttribute('role')).toBe(false);
  expect(control!.getAttribute('aria-invalid')).toBe('true');
  expect(control!.getAttribute('aria-describedby')?.split(' ')).toContain(
    fieldErrorId(controlId),
  );
  expect(control!.compareDocumentPosition(refusal!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  return control!;
}

/** Every field answered `required` at once shows its sentence under its own control. */
export async function expectFieldErrorsRenderUnderFields<F extends string>(
  coverage: FieldCoverageCase<F>,
): Promise<void> {
  const { fields, controlIdOf, locale, namespace = 'errors' } = coverage;
  const everyField: FieldErrors<F> = {};
  for (const field of fields) everyField[field] = { code: 'required' };
  coverage.answerWith(fieldsFailed(everyField));

  await coverage.submit();

  const message = messageAt(locale, `${namespace}.field.required`);
  const controls = fields.map((field) => expectUnderItsControl(controlIdOf(field), message));
  expect(document.activeElement).toBe(inDomOrder(controls)[0]);
  for (const alert of screen.queryAllByRole('alert')) {
    expect(alert.textContent ?? '').not.toContain(message);
  }
  for (const [controlId, value] of Object.entries(coverage.typed ?? {})) {
    expect((document.getElementById(controlId) as HTMLInputElement | null)?.value).toBe(value);
  }
}
