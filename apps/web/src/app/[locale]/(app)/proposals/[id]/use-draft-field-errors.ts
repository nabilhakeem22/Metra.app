'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { describeFieldError } from '@/lib/actions/field-error-message';
import type { FieldErrors } from '@/lib/actions/field-errors';

/** One cell's refusal as the builder renders it, and the edit that clears it. */
export interface DraftCellError {
  message: string | undefined;
  clear: () => void;
}

export interface DraftFieldErrorsApi {
  /** The cell at `path` (draft-field-errors.ts builds the paths). */
  cell(path: string): DraftCellError;
  /** Show these refusals in place of the last ones. */
  show(errors: FieldErrors): void;
  reset(): void;
  /** Bumped by an explicit act (Send, Retry): the caret then goes to the first. */
  invalidAttempt: number;
  focusFirst(): void;
}

/**
 * The builder's cell refusals. Autosave only marks them (D4: a save the studio
 * did not ask for never moves the caret); Send and Retry also call `focusFirst`.
 * Editing a cell clears that cell only (D3).
 */
export function useDraftFieldErrors(): DraftFieldErrorsApi {
  const te = useTranslations('errors');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [invalidAttempt, setInvalidAttempt] = useState(0);

  const show = useCallback((next: FieldErrors) => setErrors(next), []);
  const reset = useCallback(() => setErrors({}), []);
  const focusFirst = useCallback(() => setInvalidAttempt((attempt) => attempt + 1), []);

  function cell(path: string): DraftCellError {
    const error = errors[path];
    return {
      message: error ? describeFieldError(error, te) : undefined,
      clear: () =>
        setErrors((current) => {
          if (!current[path]) return current;
          const next = { ...current };
          delete next[path];
          return next;
        }),
    };
  }

  return { cell, show, reset, invalidAttempt, focusFirst };
}
