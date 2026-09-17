// Barrel for the BOQ edit cores. The single 340-line `boqs/edit.ts` moves into a
// folder here and splits into leaves in the NEXT commit. This index re-exports the
// IDENTICAL public surface, so every `@/lib/boqs/edit` import site — including the
// two dbtests under apps/web/tests/, which this wave may not edit — keeps
// resolving unchanged.
export {
  addBoqLineCore,
  addBoqSectionCore,
  deleteBoqLineCore,
  setBoqDiscountCore,
  updateBoqLineCore,
  type UpdateBoqLineInput,
} from './line-write';
