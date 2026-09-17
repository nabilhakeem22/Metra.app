// Barrel for the BOQ edit cores. The 340-line `boqs/edit.ts` did five jobs behind
// one freeze rule; it is now one file per job plus the guard they share. This
// index re-exports the IDENTICAL public surface, so every `@/lib/boqs/edit`
// import site — including two dbtests this wave may not edit — keeps resolving
// unchanged. Pure structural refactor: no SQL, no statement order and no
// transaction boundary changed.
export { updateBoqLineCore, type UpdateBoqLineInput } from './line-write';
export { addBoqLineCore } from './line-add';
export { deleteBoqLineCore } from './line-delete';
export { addBoqSectionCore } from './section';
export { setBoqDiscountCore } from './discount';
