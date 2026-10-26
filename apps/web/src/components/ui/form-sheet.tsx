'use client';

import { Loader2, X } from 'lucide-react';
import { useRef, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * The first control a person types into: never a hint or a disclosure button,
 * and never the hidden native select a Radix Select keeps inside a form.
 */
const FIRST_FIELD = [
  'input:not([type="hidden"]):not([disabled]):not([aria-hidden="true"])',
  'select:not([disabled]):not([aria-hidden="true"])',
  'textarea:not([disabled])',
].join(', ');

/**
 * The one shape every create/edit form takes: a sheet from the inline-END, the
 * title with a close button, the fields, and a footer that stays in view with
 * Cancel and Save. It is a real `<form>`, so Enter in a field submits; only a
 * submit while `pending` does nothing, because Save is never disabled to say
 * "not yet": pressing it is how a person learns what is missing. While a save
 * is pending nothing closes the sheet (Cancel, the close button, Escape or a
 * click outside): closing would not stop the save, and its answer would land
 * unseen. A refusal that belongs to no single field (`formError`) is said
 * above the footer. Opening puts the caret in the first field; each new
 * `invalidAttempt` puts it in the first refused one. A sheet opened without a
 * Radix trigger says where the caret goes back to on close (`onCloseAutoFocus`).
 */
export function FormSheet({
  open,
  onOpenChange,
  title,
  description,
  onSubmit,
  submitLabel,
  cancelLabel,
  closeLabel,
  pending,
  formError,
  invalidAttempt = 0,
  onCloseAutoFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  onSubmit: () => void;
  submitLabel: string;
  cancelLabel: string;
  closeLabel: string;
  pending: boolean;
  formError?: string | null;
  invalidAttempt?: number;
  onCloseAutoFocus?: (event: Event) => void;
  children: ReactNode;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(formRef, invalidAttempt);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (pending) return;
    onSubmit();
  }

  function changeOpen(next: boolean): void {
    if (pending && !next) return;
    onOpenChange(next);
  }

  function focusFirstField(event: Event): void {
    const field = formRef.current?.querySelector<HTMLElement>(FIRST_FIELD);
    if (!field) return;
    event.preventDefault();
    field.focus();
  }

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetContent
        side="end"
        className="w-full gap-0 p-0 sm:max-w-md"
        onOpenAutoFocus={focusFirstField}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <SheetTitle className="text-title">{title}</SheetTitle>
          <SheetClose asChild>
            <IconButton type="button" aria-label={closeLabel} className="ms-auto" disabled={pending}>
              <X className="size-4" aria-hidden />
            </IconButton>
          </SheetClose>
        </div>
        <SheetDescription className={description ? 'px-4' : 'sr-only'}>
          {description ?? title}
        </SheetDescription>

        <form ref={formRef} noValidate onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">{children}</div>
          <div className="sticky bottom-0 space-y-2 border-t bg-card px-4 py-3">
            {formError && (
              <p className="text-body text-destructive" role="alert">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={pending} onClick={() => changeOpen(false)}>
                {cancelLabel}
              </Button>
              <Button type="submit" variant="default" disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {submitLabel}
              </Button>
            </div>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
