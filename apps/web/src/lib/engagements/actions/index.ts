// Barrel for the engagement server-action layer. The single 481-line `actions.ts`
// was split by area (SRP): `data-entry` (create, off-plan flag, ROM
// acknowledgement, event correction), `concept-transitions`, `design-transitions`
// and `closing-transitions` (the wired transition wrappers, by phase of the
// delivery), `payments` (record + log-and-advance), `deliverables` (artifact
// + deliverable uploads/download), `share` (client delivery links), `reminder`
// (show and resend the existing link), `offline-approval` (an approval the
// client gave the studio directly) and `client-expected` (the date the client
// page promises for the next step). Each split
// module carries its own `'use server';`. This barrel is a PLAIN re-export module
// (NOT `'use server'`: a `'use server'` barrel rejects `export *`/re-exports — the
// action references already live in the split modules) that names the IDENTICAL
// public surface, so every `@/lib/engagements/actions` import site keeps resolving
// unchanged. Pure structural refactor — no action, signature, or behaviour changed.
export {
  createEngagement,
  setEngagementOffPlan,
  recordEventCorrection,
  recordRomAcknowledgement,
} from './data-entry';
export {
  submitDesignFee,
  confirmAndPayDeposit,
  spatialBaseReady,
  optionsReady,
  selectConcept,
  requestRevision,
  confirmConcept,
} from './concept-transitions';
export {
  rendersReady,
  flagAsBuiltVariance,
  attestAsBuiltClean,
  approveDesign,
  rejectDesign,
  designChangeRaised,
} from './design-transitions';
export {
  draftReady,
  finalizeBOQ,
  chooseDesignOnly,
  chooseExecution,
  recipientAcknowledges,
  abandonEngagement,
} from './closing-transitions';
export { recordHandoffAcknowledgement } from './handoff';
export { setEngagementRom, issueRom } from './rom';
export { setClientExpectedDate } from './client-expected';
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
