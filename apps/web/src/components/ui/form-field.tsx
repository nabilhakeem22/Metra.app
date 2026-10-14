'use client';

import { useTranslations } from 'next-intl';
import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { FieldHint } from '@/components/ui/field-hint';
import { Label } from '@/components/ui/label';

type ChangeHandler = (...args: never[]) => void;

interface DescribableProps {
  id?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-describedby'?: string;
  'aria-required'?: boolean | 'true' | 'false';
  onChange?: ChangeHandler;
  onValueChange?: ChangeHandler;
}

/**
 * The child's own change handler with `onEdit` run first. A Radix-style control
 * reports through `onValueChange`; every other control through `onChange`.
 */
function withEdit(
  props: DescribableProps,
  onEdit: (() => void) | undefined,
): Pick<DescribableProps, 'onChange' | 'onValueChange'> {
  if (!onEdit) return {};
  const key = props.onValueChange ? 'onValueChange' : 'onChange';
  const own = props[key];
  return {
    [key]: (...args: never[]) => {
      onEdit();
      own?.(...args);
    },
  };
}

/**
 * One labelled form control: the label, a required mark (a visible `*` plus a
 * screen-reader "required"), an optional hint beside the label, and the
 * refusal for THIS field under it. The control is the child: it is cloned with
 * the field's `id`, `aria-invalid` while there is an error, and
 * `aria-describedby` pointing at the hint and the error text. A string hint
 * becomes the standard "?" FieldHint; any other node is rendered as given.
 * `onEdit` runs before the child's own change handler, so editing the field can
 * clear its refusal.
 */
export function FormField({
  id,
  label,
  required = false,
  error,
  hint,
  onEdit,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string | null;
  hint?: ReactNode;
  onEdit?: () => void;
  children: ReactElement<DescribableProps>;
}) {
  const t = useTranslations('common');
  const hintId = typeof hint === 'string' ? `${id}-hint` : undefined;
  const errorId = error ? fieldErrorId(id) : undefined;
  const describedBy =
    [children.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="flex items-center">
        {label}
        {required && (
          <>
            <span className="ms-1 text-[color:var(--danger)]" aria-hidden>
              *
            </span>
            <span className="sr-only"> {t('required')}</span>
          </>
        )}
        {typeof hint === 'string' ? <FieldHint id={hintId} hint={hint} /> : hint}
      </Label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : children.props['aria-invalid'],
        'aria-describedby': describedBy,
        'aria-required': required || children.props['aria-required'],
        ...withEdit(children.props, onEdit),
      })}
      <FieldErrorText id={fieldErrorId(id)} message={error} />
    </div>
  );
}
