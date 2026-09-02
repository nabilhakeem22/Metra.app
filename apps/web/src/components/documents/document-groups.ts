// Grouping documents under the firm's filing categories — PURE and CLIENT-SAFE: no
// db import, no `server-only`, no 'use client'. Shared by the client and project
// document tabs, which the spec says must behave identically.

/** The minimum a document must carry to be grouped. */
export interface CategorisedDocument {
  categoryId: string | null;
  categoryNameEn: string | null;
  categoryNameAr: string | null;
}

export interface DocumentGroup<T> {
  /** Null for the uncategorised bucket. */
  categoryId: string | null;
  nameEn: string | null;
  nameAr: string | null;
  documents: T[];
}

/**
 * Group documents under their category, preserving the order they arrive in (the
 * queries hand them over newest-first, and that ordering should survive inside each
 * group).
 *
 * Uncategorised documents go LAST, in their own group, rather than being hidden or
 * silently dropped: every document uploaded before categories existed is
 * uncategorised, so "no category" is the most populated bucket on day one and has to
 * be a first-class, visible thing.
 *
 * Category groups appear in first-seen order, which — given the queries sort by
 * date — means the most recently used category is nearest the top. That is more
 * useful on a busy client than alphabetical, and it needs no extra query.
 */
export function groupByCategory<T extends CategorisedDocument>(
  documents: readonly T[],
): DocumentGroup<T>[] {
  const groups = new Map<string, DocumentGroup<T>>();
  const uncategorised: T[] = [];

  for (const doc of documents) {
    if (!doc.categoryId) {
      uncategorised.push(doc);
      continue;
    }
    const existing = groups.get(doc.categoryId);
    if (existing) {
      existing.documents.push(doc);
      continue;
    }
    groups.set(doc.categoryId, {
      categoryId: doc.categoryId,
      nameEn: doc.categoryNameEn,
      nameAr: doc.categoryNameAr,
      documents: [doc],
    });
  }

  const out = [...groups.values()];
  if (uncategorised.length > 0) {
    out.push({
      categoryId: null,
      nameEn: null,
      nameAr: null,
      documents: uncategorised,
    });
  }
  return out;
}
