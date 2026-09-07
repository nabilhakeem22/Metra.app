// PURE and client-safe: no db, no server-only. Split out of core.ts so it can
// be unit-tested — core.ts pulls in server-only transitively, and this repo
// deliberately does not stub that in vitest.

/**
 * Route imported text to the right half of a bilingual pair.
 *
 * A sheet carries no language tag, so without this every Arabic description
 * imported into an Arabic-first product would land in `description_en`. The
 * bilingual CHECK only demands that ONE side is present, so it would have worked
 * — and been wrong in a way nothing would surface until someone filtered or
 * exported by language.
 *
 * The test is the Arabic block plus the Arabic Supplement/Extended ranges; a
 * mixed string ("12mm سقف") counts as Arabic, which is the right call for a BOQ
 * where the measurement is Latin and the noun is not.
 */
export function bilingualFor(text: string): {
  descriptionAr: string | null;
  descriptionEn: string | null;
} {
  const arabic = /[؀-ۿݐ-ݿࢠ-ࣿ]/.test(text);
  return {
    descriptionAr: arabic ? text : null,
    descriptionEn: arabic ? null : text,
  };
}
