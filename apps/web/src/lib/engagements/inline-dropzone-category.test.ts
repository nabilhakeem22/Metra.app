import { describe, expect, it } from 'vitest';
import { inlineDropzoneCategory } from './inline-dropzone-category';
import { CATEGORY_WRITE_KIND } from './deliverable-files';

// The regression this file exists for: the command card's dropzone used to map
// `layout` to the `layout` category, which WRITES `autocad`. `optionsReady` only
// ever counts `concept_option`, so every upload through the card's own button
// left the gate unclearable and the studio hard-stuck at `layout`.

describe('inlineDropzoneCategory', () => {
  it('uploads a CONCEPT OPTION at every concept-presenting state', () => {
    expect(inlineDropzoneCategory('layout')).toBe('conceptOption');
    expect(inlineDropzoneCategory('concept_review')).toBe('conceptOption');
    expect(inlineDropzoneCategory('negotiation')).toBe('conceptOption');
  });

  it('keeps the other mapped states on their own categories', () => {
    expect(inlineDropzoneCategory('design_3d')).toBe('render');
    expect(inlineDropzoneCategory('boq')).toBe('boq');
    expect(inlineDropzoneCategory('shop_drawings')).toBe('shopDrawing');
  });

  it('returns null for a state with no inline dropzone', () => {
    // `survey` deliberately has none — it uses the toolbar so a measured survey
    // is never mistaken for a CAD import.
    expect(inlineDropzoneCategory('survey')).toBeNull();
    expect(inlineDropzoneCategory('created')).toBeNull();
    expect(inlineDropzoneCategory('abandoned')).toBeNull();
  });

  // The whole point of the fix: what the card writes at `layout` must be the kind
  // the `optionsReady` guard counts. If these ever diverge the studio is stuck
  // again, so assert the composition end-to-end rather than the map alone.
  it('writes concept_option — the kind optionsReady counts — at layout', () => {
    const category = inlineDropzoneCategory('layout');
    expect(category).not.toBeNull();
    expect(CATEGORY_WRITE_KIND[category!]).toBe('concept_option');
  });

  it('still writes autocad through the layout category (spatialBaseReady path)', () => {
    expect(CATEGORY_WRITE_KIND.layout).toBe('autocad');
  });
});
