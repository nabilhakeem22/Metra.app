'use client';

import { useCallback, useRef, useState } from 'react';
import { describeFailure, describeRejection, type Translate } from '@/lib/actions/error-message';
import { describeFieldError } from '@/lib/actions/field-error-message';
import { hasFieldErrors, type FieldError, type FieldErrors } from '@/lib/actions/field-errors';
import type { ActionResult } from '@/lib/actions/result';

/** What a form shows after an answer: errors under fields, and one above the footer. */
interface Shown<F extends string> {
  fields: FieldErrors<F>;
  formError: string | null;
}

const NOTHING_SHOWN: Shown<never> = { fields: {}, formError: null };

/**
 * Split field errors into the ones this form renders and a sentence for the
 * rest. A path the form has no control for is said above the footer, never
 * dropped: a refusal nobody can see is worse than one in the wrong place.
 */
function splitByRendered<F extends string>(
  errors: FieldErrors,
  rendered: readonly F[],
  t: Translate,
): Shown<F> {
  const fields: Partial<Record<F, FieldError>> = {};
  const elsewhere = new Set<string>();
  for (const [path, error] of Object.entries(errors)) {
    if (!error) continue;
    if ((rendered as readonly string[]).includes(path)) fields[path as F] = error;
    else elsewhere.add(describeFieldError(error, t));
  }
  return { fields, formError: elsewhere.size > 0 ? [...elsewhere].join(' ') : null };
}

/**
 * The refusal state of one form. `bind(field)` spreads into a FormField (its
 * message and the edit that clears it, D3); `formError` goes above the footer;
 * `invalidAttempt` drives FormSheet's focus on the first refused field. The
 * messages are resolved with the caller's translator, so the studio passes its
 * `errors` namespace and a client link page `portal.errors`.
 */
export function useFieldErrors<F extends string>({
  fields: rendered,
  translate,
}: {
  fields: readonly F[];
  translate: Translate;
}) {
  const [shown, setShown] = useState<Shown<F>>(NOTHING_SHOWN);
  const [invalidAttempt, setInvalidAttempt] = useState(0);
  // The fields edited since the last submit (a `clear` or `applyLocal`, which
  // every form runs as it sends). A server answer about the OLD value of one of
  // them is dropped, and once the person has moved on the caret stays put.
  const edited = useRef(new Set<string>());

  function showFieldErrors(errors: FieldErrors, answeredLate: boolean): void {
    const current = answeredLate
      ? Object.fromEntries(Object.entries(errors).filter(([path]) => !edited.current.has(path)))
      : errors;
    const next = splitByRendered(current, rendered, translate);
    setShown(next);
    const typingElsewhere = answeredLate && edited.current.size > 0;
    if (hasFieldErrors(next.fields) && !typingElsewhere) setInvalidAttempt((attempt) => attempt + 1);
  }

  function messageFor(field: F): string | undefined {
    const error = shown.fields[field];
    return error ? describeFieldError(error, translate) : undefined;
  }

  function clearField(field: F): void {
    edited.current.add(field);
    setShown((current) => {
      if (!current.fields[field]) return current;
      const fields = { ...current.fields };
      delete fields[field];
      return { ...current, fields };
    });
  }

  /** Stable, so a form can clear on open from an effect. */
  const clear = useCallback((): void => {
    edited.current = new Set();
    setShown(NOTHING_SHOWN);
  }, []);

  /** Show what a failed result says; true when it carried an error. */
  function applyResult(result: ActionResult): boolean {
    if (result.ok) {
      clear();
      return false;
    }
    if (result.fields && hasFieldErrors(result.fields)) showFieldErrors(result.fields, true);
    else setShown({ fields: {}, formError: describeFailure(result, translate) });
    return true;
  }

  /** A rejected action promise: the answer never came back. */
  function applyRejection(rejection: unknown): void {
    setShown({ fields: {}, formError: describeRejection(rejection, translate) });
  }

  /** The form's own pre-check before sending; true = refused, do not send. */
  function applyLocal(errors: FieldErrors<F>): boolean {
    if (!hasFieldErrors(errors)) {
      clear();
      return false;
    }
    edited.current = new Set();
    showFieldErrors(errors, false);
    return true;
  }

  return {
    bind: (field: F) => ({ error: messageFor(field), onEdit: () => clearField(field) }),
    messageFor,
    formError: shown.formError,
    invalidAttempt,
    applyResult,
    applyRejection,
    applyLocal,
    clear,
  };
}

/** What a form holds from useFieldErrors, for a child that renders its fields. */
export type FieldErrorsApi<F extends string> = ReturnType<typeof useFieldErrors<F>>;
