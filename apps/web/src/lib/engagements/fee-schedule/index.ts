// Barrel for the fee schedule. The single 182-line `fee-schedule.ts` was split
// along its two concerns: `validate` (the pure payload check) and `generate` (the
// executor-only write). Every `@/lib/engagements/fee-schedule` import site keeps
// resolving unchanged.
//
// Design-Engagement Machine, Step 3 — the `generateFeeSchedule` side-effect of
// `submitDesignFee`. Two concerns kept explicitly separate:
//   1) validateFeeSchedule — PURE. Validates the payload with exact scale-4
//      BigInt math (never parseFloat) and returns the canonical rows to write.
//   2) generateFeeSchedule — the executor-only runner. Runs INSIDE the executor's
//      transaction so the fee write + milestone rows commit atomically with the
//      state move, or not at all. On any validation failure it `fail()`s with a
//      coded error and the executor rolls the whole tx back (state stays `created`,
//      no milestone rows).
export { validateFeeSchedule, type FeeScheduleField } from './validate';
export { generateFeeSchedule } from './generate';
