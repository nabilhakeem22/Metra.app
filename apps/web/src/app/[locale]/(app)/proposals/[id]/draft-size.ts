// How big a draft save may be. PURE and CLIENT-SAFE.
//
// Server actions refuse a body over `experimental.serverActions.bodySizeLimit`
// (next.config.mjs, 4 MB) with a bare 413 the client can only read as "something
// went wrong", and the builder's every save, Send included, would hit it again
// and again. So the builder measures first and says what is wrong instead. The
// guard sits under the limit: the action body React encodes is a little larger
// than the JSON measured here.
export const SERVER_ACTION_BODY_LIMIT_MB = 4;

export const DRAFT_SAVE_MAX_BYTES = Math.floor(SERVER_ACTION_BODY_LIMIT_MB * 1024 * 1024 * 0.9);

/** True when this save's JSON payload is past what the server action accepts. */
export function exceedsDraftSaveLimit(payloadJson: string): boolean {
  return new TextEncoder().encode(payloadJson).byteLength > DRAFT_SAVE_MAX_BYTES;
}
