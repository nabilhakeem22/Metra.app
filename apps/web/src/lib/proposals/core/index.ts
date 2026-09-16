// BARREL LAW: a module barrel re-exports only symbols defined under that module's
// own `core/`, `lifecycle/` or `queries/`. It never re-exports a shared kernel and
// it never re-exports another module. Cross-module reuse goes through
// `lib/<kernel>`.
//
// The proposal-core surface: creation, the draft input shapes, the four-stage
// draft save, and the sibling `../lifecycle` transitions — re-exported so
// `@/lib/proposals/core` stays the one import surface for the module's own
// callers and the action-core DB suites, exactly as `contracts/core/index.ts`
// and `variations/core/index.ts` already do.
export * from './create';
export * from './types';
export { saveProposalDraftCore } from './draft-save';
export {
  deleteDraftProposalCore,
  expireProposalCore,
  sendProposalCore,
  supersedeProposalCore,
} from '../lifecycle';
