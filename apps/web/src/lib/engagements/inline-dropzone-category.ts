// Which working-file category the command card's inline dropzone uploads at each
// design state. PURE and CLIENT-SAFE (a plain non-client module, the `tabs.ts`
// pattern): the mapping table is data, not UI, so it lives beside the other
// engagement derivations where a unit test can reach it without pulling React,
// next-intl, or the server actions behind the dropzone component into the test
// graph.
//
// State -> category (owner table):
//   layout / concept_review / negotiation -> concept option
//   design_3d                             -> render set
//   shop_drawings                         -> shop drawings
//   boq                                   -> draft BOQ
// A state absent from the map has no inline dropzone (e.g. survey uses the
// toolbar so a non-off-plan measured survey isn't mistaken for a CAD import).
//
// Across layout / concept_review / negotiation the studio is presenting the 2–4
// concept options the client chooses between, so EACH file dropped there IS one
// concept option: the category writes `concept_option`, which is exactly what the
// `optionsReady` guard counts. Pointing these states at `layout` instead wrote
// `autocad` and left the gate permanently unclearable from the card — the
// production dead-end this map fixes.
//
// The `layout`/`autocad` category is NOT retired: it stays available in the
// working-files tray for the spatial base / developer CAD set, which is what
// `spatialBaseReady` consumes.
import type { DesignState } from './states';
import type { WorkingFileCategory } from './working-files';

const STATE_DROPZONE_CATEGORY: Partial<Record<DesignState, WorkingFileCategory>> = {
  layout: 'conceptOption',
  concept_review: 'conceptOption',
  negotiation: 'conceptOption',
  design_3d: 'render',
  boq: 'boq',
  shop_drawings: 'shopDrawing',
};

/** The inline-dropzone category for a state, or null when the stage has none. */
export function inlineDropzoneCategory(
  state: DesignState,
): WorkingFileCategory | null {
  return STATE_DROPZONE_CATEGORY[state] ?? null;
}
