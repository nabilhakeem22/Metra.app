// Barrel for the BOQ cores. The single 334-line `boqs/core.ts` moves into a folder
// here and splits into leaves in the NEXT commit, mirroring `contracts/core/`,
// `proposals/core/` and `variations/core/`. This index re-exports the IDENTICAL
// public surface, so every `@/lib/boqs/core` import site — including the two
// dbtests under apps/web/tests/, which this wave may not edit — keeps resolving
// unchanged.
export {
  MAX_BOQ_LINES,
  commitImportCore,
  createBoqCore,
  recomputeBoqTotals,
  type CommitImportInput,
  type CreateBoqInput,
} from './commit-import';
