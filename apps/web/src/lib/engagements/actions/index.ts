// Barrel for the engagement server-action layer. The single 481-line `actions.ts`
// was split by area (SRP): `lifecycle` (create + the wired transition wrappers +
// ROM data-entry), `payments` (record + log-and-advance), `deliverables` (artifact
// + deliverable uploads/download), and `share` (client delivery links). Each split
// module carries its own `'use server';`. This barrel is a PLAIN re-export module
// (NOT `'use server'`: a `'use server'` barrel rejects `export *`/re-exports — the
// action references already live in the split modules) that names the IDENTICAL
// public surface, so every `@/lib/engagements/actions` import site keeps resolving
// unchanged. Pure structural refactor — no action, signature, or behaviour changed.
export {
  createEngagement,
  submitDesignFee,
  confirmAndPayDeposit,
  spatialBaseReady,
  optionsReady,
  selectConcept,
  requestRevision,
  confirmConcept,
  rendersReady,
  flagAsBuiltVariance,
  attestAsBuiltClean,
  approveDesign,
  rejectDesign,
  draftReady,
  finalizeBOQ,
  chooseDesignOnly,
  chooseExecution,
  recipientAcknowledges,
  abandonEngagement,
  setEngagementRom,
  setEngagementOffPlan,
  recordRomAcknowledgement,
  recordHandoffAcknowledgement,
} from './lifecycle';
export {
  recordPayment,
  logPaymentAndAdvance,
  confirmPaymentClaim,
  dismissPaymentClaim,
} from './payments';
export {
  recordArtifact,
  createDeliverableUpload,
  attachDeliverable,
  getDeliverableUrl,
} from './deliverables';
export {
  shareDeliveryLink,
  rotateDeliveryLink,
  revokeDeliveryLink,
} from './share';
