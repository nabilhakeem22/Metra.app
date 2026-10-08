// Barrel for the engagement server-action layer. The single 481-line `actions.ts`
// was split by area (SRP): `lifecycle` (create + the wired transition wrappers +
// ROM data-entry), `payments` (record + log-and-advance), `deliverables` (artifact
// + deliverable uploads/download), `share` (client delivery links), `reminder`
// (show and resend the existing link) and `offline-approval` (an approval the
// client gave the studio directly). Each split
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
  designChangeRaised,
  draftReady,
  finalizeBOQ,
  chooseDesignOnly,
  chooseExecution,
  recipientAcknowledges,
  abandonEngagement,
  setEngagementOffPlan,
  recordEventCorrection,
  recordRomAcknowledgement,
} from './lifecycle';
export { recordHandoffAcknowledgement } from './handoff';
export { setEngagementRom, issueRom } from './rom';
export {
  recordPayment,
  logPaymentAndAdvance,
  confirmPaymentClaim,
  dismissPaymentClaim,
} from './payments';
export {
  recordArtifact,
  createDeliverableUpload,
  renewDeliverableUpload,
  attachDeliverable,
  getDeliverableUrl,
  setArtifactClientVisibility,
} from './deliverables';
export {
  recordOfflineConceptApproval,
  recordOfflineDesignApproval,
} from './offline-approval';
export {
  shareDeliveryLink,
  rotateDeliveryLink,
  revokeDeliveryLink,
} from './share';
export {
  revealDeliveryLink,
  prepareDeliveryReminder,
  emailDeliveryReminder,
} from './reminder';
