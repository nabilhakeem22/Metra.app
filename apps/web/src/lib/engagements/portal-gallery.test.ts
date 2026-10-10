import { describe, expect, it } from 'vitest';
import {
  galleryImages,
  listedDocuments,
  lockedWorkCount,
  picturesByCategory,
  workImages,
  type PortalDocument,
} from './portal-gallery';

// AC 51: pictures are images the client may at least preview; a withheld file
// is never one, and a PDF stays in the documents list.

function doc(id: string, overrides: Partial<PortalDocument>): PortalDocument {
  return { id, category: 'render', sharedAt: null, commentCount: 0, access: 'download', media: 'image', ...overrides };
}

const DOCUMENTS = [
  doc('render-new', {}),
  doc('concept-a', { category: 'concept', access: 'preview' }),
  doc('boq', { category: 'boq', media: 'pdf', access: 'withheld' }),
  doc('render-withheld', { access: 'withheld' }),
  doc('drawing', { category: 'drawing', media: 'pdf' }),
  doc('render-old', {}),
  doc('layout-dwg', { category: 'layout', media: 'other' }),
];

const ids = (documents: PortalDocument[]) => documents.map((document) => document.id);

describe('portal pictures', () => {
  it('a picture is a previewable image; everything else stays listed', () => {
    expect(ids(galleryImages(DOCUMENTS))).toEqual(['render-new', 'concept-a', 'render-old']);
    expect(ids(listedDocuments(DOCUMENTS))).toEqual(['boq', 'render-withheld', 'drawing', 'layout-dwg']);
  });

  it('groups by category in the order of the newest picture of each', () => {
    expect(picturesByCategory(galleryImages(DOCUMENTS)).map((group) => [group.category, ids(group.images)])).toEqual([
      ['render', ['render-new', 'render-old']],
      ['concept', ['concept-a']],
    ]);
  });

  it('the concept hero shows concept options, the design hero renders, the handover nothing', () => {
    expect(ids(workImages(DOCUMENTS, 'concept'))).toEqual(['concept-a']);
    expect(ids(workImages(DOCUMENTS, 'design'))).toEqual(['render-new', 'render-old']);
    expect(workImages(DOCUMENTS, 'handoff')).toEqual([]);
  });

  it('F8: counts the work under review the client cannot see yet', () => {
    expect(lockedWorkCount(DOCUMENTS, 'design')).toBe(1);
    expect(lockedWorkCount(DOCUMENTS, 'concept')).toBe(0);
    expect(lockedWorkCount(DOCUMENTS, 'handoff')).toBe(0);
  });
});
