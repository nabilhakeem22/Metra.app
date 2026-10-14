'use client';

import { forwardRef } from 'react';
import { FieldErrorText, fieldErrorId } from '@/components/ui/field-error-text';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** The longest signer name the link actions store (they cut at 120). */
const NAME_MAX = 120;

/**
 * The client's name on a link page (/p, /c, /v): a visible label, never a
 * placeholder only, and, where the name is required, the refusal under it.
 */
export const LinkNameField = forwardRef<
  HTMLInputElement,
  { id: string; label: string; value: string; onChange: (value: string) => void; error?: string | null }
>(function LinkNameField({ id, label, value, onChange, error }, ref) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        ref={ref}
        id={id}
        value={value}
        maxLength={NAME_MAX}
        autoComplete="name"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? fieldErrorId(id) : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldErrorText id={fieldErrorId(id)} message={error} />
    </div>
  );
});
