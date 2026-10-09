// Is a failed Resend send worth backing off from? PURE: no I/O.
//
// TRANSIENT: the send timed out or threw, the network failed, or Resend answered
// 5xx. A run of these means Resend is down or hanging, and every further send
// would wait out its deadline. REFUSED: Resend answered 4xx. An unverified
// sending domain refuses every recipient but the account owner with a 4xx; that
// says nothing about Resend's health, and must not stop the owner's own email.
//
// The SDK (resend 4.x) hands an API error back as the response body, which
// carries `statusCode`; a network failure, or a body that is not JSON, comes back
// as `application_error` with no status.
export function isTransientResendError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true;
  const { statusCode, name } = error as { statusCode?: unknown; name?: unknown };
  if (typeof statusCode === 'number') return statusCode >= 500;
  return name === 'application_error' || name === 'internal_server_error';
}
