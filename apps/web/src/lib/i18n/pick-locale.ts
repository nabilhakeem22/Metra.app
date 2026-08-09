// Empty-cell fallback is a RENDER rule (§4.1): never render an empty cell.
// If the requested locale's value is empty, return the other language and mark
// it as a fallback so the UI can flag it as untranslated.

export interface PickedLocale {
  value: string;
  isFallback: boolean;
}

type BilingualRow = Record<string, unknown>;

export function pickLocale(
  row: BilingualRow | null | undefined,
  field: string,
  locale: string,
): PickedLocale {
  if (!row) return { value: '', isFallback: false };

  const wantAr = locale.startsWith('ar');
  const primaryKey = `${field}${wantAr ? 'Ar' : 'En'}`;
  const otherKey = `${field}${wantAr ? 'En' : 'Ar'}`;

  const primary = row[primaryKey];
  if (typeof primary === 'string' && primary.trim() !== '') {
    return { value: primary, isFallback: false };
  }

  const other = row[otherKey];
  if (typeof other === 'string' && other.trim() !== '') {
    return { value: other, isFallback: true };
  }

  // Both absent/empty. Never crash; surface as a fallback so the UI can flag it.
  // (The DB present-check should make this unreachable for persisted rows.)
  return { value: '', isFallback: true };
}
