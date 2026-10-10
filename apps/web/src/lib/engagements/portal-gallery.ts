// Which released files the client page shows as pictures (Round C). PURE and
// client-safe: the gallery, the lightbox and the hero's "see the work first"
// strip read the same rule, so a picture never shows in one and not another.
//
// A picture is an IMAGE (the database's one media rule) the client may at least
// preview. A withheld file is never a picture, whatever it is; a PDF or any
// other file stays in the documents list with its View and Download links.
import type { ClientDocumentCategory } from './portal-documents';
import type { HeroGroup } from './portal-hero';
import type { PublicDelivery } from './public/types';

export type PortalDocument = PublicDelivery['documents'][number];

/** The pictures, in the order given (newest share first). */
export function galleryImages(documents: readonly PortalDocument[]): PortalDocument[] {
  return documents.filter((document) => document.media === 'image' && document.access !== 'withheld');
}

/** Everything that is not a picture: the documents list keeps these. */
export function listedDocuments(documents: readonly PortalDocument[]): PortalDocument[] {
  const pictures = new Set(galleryImages(documents));
  return documents.filter((document) => !pictures.has(document));
}

/** The pictures grouped by category, groups in the order their newest picture appears. */
export function picturesByCategory(
  images: readonly PortalDocument[],
): Array<{ category: ClientDocumentCategory; images: PortalDocument[] }> {
  const groups = new Map<ClientDocumentCategory, PortalDocument[]>();
  for (const image of images) groups.set(image.category, [...(groups.get(image.category) ?? []), image]);
  return [...groups.entries()].map(([category, grouped]) => ({ category, images: grouped }));
}

/** The category a review hero asks about: the concept options, or the final renders. */
const WORK_CATEGORY: Partial<Record<HeroGroup, ClientDocumentCategory>> = {
  concept: 'concept',
  design: 'render',
};

/** The pictures a review hero shows beside its buttons (none for the handover). */
export function workImages(documents: readonly PortalDocument[], group: HeroGroup): PortalDocument[] {
  const category = WORK_CATEGORY[group];
  return category ? galleryImages(documents).filter((document) => document.category === category) : [];
}

/**
 * How many files of the work under review the client CANNOT look at yet (fix
 * round F8): withheld until a payment, e.g. a render stored in a format the
 * preview rule does not cover. The hero says so rather than asking for an
 * approval of work the client has not seen.
 */
export function lockedWorkCount(documents: readonly PortalDocument[], group: HeroGroup): number {
  const category = WORK_CATEGORY[group];
  return category ? documents.filter((document) => document.category === category && document.access === 'withheld').length : 0;
}
