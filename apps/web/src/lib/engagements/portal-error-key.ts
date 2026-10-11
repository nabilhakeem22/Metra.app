// Which portal error message a failed client action shows. PURE and CLIENT-SAFE.
//
// The SDF result union is shared across every tokenised surface, so it carries
// codes the delivery portal has no copy for (`already_responded`,
// `contract_inactive`). Rendering `error.${code}` for one of those would throw
// MISSING_MESSAGE in the browser; this narrows every code to a key the
// `delivery.actions.error` and `delivery.payments.error` catalogs both hold.

/** The error keys the delivery portal's catalogs define. */
export type PortalErrorKey =
  | 'token_invalid'
  | 'token_expired'
  | 'not_active'
  | 'wrong_state'
  | 'generic';

/** Map an action's error code to a portal error key; anything unknown is generic. */
export function portalErrorKey(code: string | null | undefined): PortalErrorKey {
  switch (code) {
    case 'token_invalid':
    case 'token_expired':
    case 'not_active':
    case 'wrong_state':
      return code;
    default:
      return 'generic';
  }
}

/** The error keys a document thread's catalog (`delivery.comments.error`) defines.
 *  `load_failed` is the shared thread hook's THREAD_LOAD_FAILED: a READ failed and
 *  nothing was sent, so it must never read as "that didn't send". */
export type PortalCommentErrorKey = PortalErrorKey | 'empty' | 'too_many' | 'load_failed';

/** Map a comment send/read error code to a key the comments catalog holds. */
export function portalCommentErrorKey(code: string | null | undefined): PortalCommentErrorKey {
  return code === 'empty' || code === 'too_many' || code === 'load_failed' ? code : portalErrorKey(code);
}
