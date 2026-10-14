/** The id of the text that explains why field `fieldId` was refused. */
export function fieldErrorId(fieldId: string): string {
  return `${fieldId}-error`;
}

/**
 * The refusal for ONE field, said under its control. It carries no role: the
 * form moves focus to the first refused control on submit, so a screen reader
 * reads this text through that control's `aria-describedby`, once. Namespace-
 * free on purpose: the studio and the client portal resolve the message with
 * their own translator and pass the sentence in.
 */
export function FieldErrorText({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={id} className="text-body text-destructive">
      {message}
    </p>
  );
}
