/**
 * A cockpit form's refusal that belongs to no single field, said above its
 * Save. Announced (role alert), unlike a field refusal: focus does not move to
 * it, so a screen reader would not otherwise read it.
 */
export function FormRefusal({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-body text-destructive" role="alert">
      {message}
    </p>
  );
}
