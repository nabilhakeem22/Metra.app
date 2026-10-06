'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link } from '@/i18n/routing';

// The "Start delivery" form's small presentational pieces.

/** A prerequisite the studio has to add first, with the button that adds it. */
export function NeedFirst({ message, href, cta }: { message: string; href?: string; cta: string }) {
  return (
    <div className="space-y-2 rounded-item border bg-muted/40 p-3 text-body text-muted-foreground">
      <p>{message}</p>
      {href && (
        <Button asChild size="sm" variant="secondary">
          <Link href={href}>{cta}</Link>
        </Button>
      )}
    </div>
  );
}

/** A required select: marked, `aria-required`, no silent default, its error under it. */
export function RequiredSelect(props: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  disabled?: boolean;
  hint?: ReactNode;
  error?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>
        {props.label} <span aria-hidden>*</span>
      </Label>
      <Select value={props.value} onValueChange={props.onChange} disabled={props.disabled}>
        <SelectTrigger id={props.id} aria-required="true">
          <SelectValue placeholder={props.placeholder} />
        </SelectTrigger>
        <SelectContent>
          {props.options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {props.hint}
      <FieldError message={props.error} />
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="text-body text-destructive" role="alert">
      {message}
    </p>
  );
}
