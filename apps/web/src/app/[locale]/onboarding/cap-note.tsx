// The at-the-cap note under an onboarding field (F14): a note the control is
// described by, never its error, because a value exactly at the cap is valid.
import type { OnboardingField } from './profile-field-limits';

export const capNoteId = (field: OnboardingField) => `${field}-limit`;

/** The ids a control is described by, or none. */
export function describedBy(...ids: (string | undefined)[]): string | undefined {
  return ids.filter(Boolean).join(' ') || undefined;
}

/** "This box holds N characters": a note, not a refusal. Renders only with an id. */
export function CapNote({ id, text }: { id: string | undefined; text: string }) {
  if (!id) return null;
  return (
    <p id={id} className="text-caption text-muted-foreground">
      {text}
    </p>
  );
}
