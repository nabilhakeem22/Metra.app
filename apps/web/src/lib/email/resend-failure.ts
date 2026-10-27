// Is a failed Resend send worth backing off from, and what did Resend say?
// PURE: no I/O.
//
// TRANSIENT: the send timed out or threw, the network failed, Resend answered
// 5xx, or it answered 429 (its rate limit: the same send a little later goes
// through, H5 reliability R6). A run of these means Resend is down, hanging or
// throttling, and every further send would fail the same way. REFUSED: any
// other 4xx. An unverified sending domain refuses every recipient but the
// account owner with a 4xx; that says nothing about Resend's health, and must
// not stop the owner's own email.
//
// The SDK (resend 4.x) hands an API error back as the response body, which
// carries `statusCode`; a network failure, or a body that is not JSON, comes back
// as `application_error` with no status.

/** Resend's rate limit. */
const TOO_MANY_REQUESTS = 429;

export function isTransientResendError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true;
  const { statusCode, name } = error as { statusCode?: unknown; name?: unknown };
  if (typeof statusCode === 'number') return statusCode >= 500 || statusCode === TOO_MANY_REQUESTS;
  return name === 'application_error' || name === 'internal_server_error';
}

/** What Resend's error says about itself, for one log line: its status and name, never its message. */
export interface ResendRefusal {
  statusCode: number | null;
  name: string | null;
}

/** The status and the name of a Resend error (null for either it does not carry). */
export function resendRefusalOf(error: unknown): ResendRefusal {
  const { statusCode, name } = (typeof error === 'object' && error !== null ? error : {}) as { statusCode?: unknown; name?: unknown };
  return {
    statusCode: typeof statusCode === 'number' ? statusCode : null,
    name: typeof name === 'string' ? name.slice(0, 64) : null,
  };
}
