// What the studio types on the new-change-order form, put in the columns of
// the page's language (as a section or a project type name is saved): a title
// typed on the Arabic page is the order's Arabic title, never its English one.
// The other language's column is left out, so a later save never blanks it.
// PURE and CLIENT-SAFE.

const arabicPage = (locale: string) => locale.startsWith('ar');

export type TypedHeaderColumns =
  | { titleAr: string; reasonAr: string | null }
  | { titleEn: string; reasonEn: string | null };

/** The order's title and reason; a blank reason is no reason. */
export function typedHeaderColumns(locale: string, typed: { title: string; reason: string }): TypedHeaderColumns {
  const reason = typed.reason || null;
  return arabicPage(locale) ? { titleAr: typed.title, reasonAr: reason } : { titleEn: typed.title, reasonEn: reason };
}

/** A line's description. */
export function typedDescriptionColumn(locale: string, description: string): { descriptionAr: string } | { descriptionEn: string } {
  return arabicPage(locale) ? { descriptionAr: description } : { descriptionEn: description };
}
