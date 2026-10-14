// The failures every client link page (/d, /p, /c, /v) says the same way, from
// the shared `portal.errors` catalogue (فصحى). PURE and CLIENT-SAFE: the server
// actions build these, the pages render them.
import { describeFailure, describeRejection, type Translate } from '@/lib/actions/error-message';

/** Every key `portal.errors` holds for a failed act. */
export type SharedPortalError =
  | 'token_invalid'
  | 'token_expired'
  | 'not_active'
  | 'too_many'
  | 'uncertain'
  | 'generic';

/** A failure as a page keeps it for display: a coded answer, or a promise that never answered. */
export type ShownPortalFailure = { error: SharedPortalError; reference?: string } | { rejection: unknown };

const SHARED: ReadonlySet<string> = new Set<SharedPortalError>([
  'token_invalid',
  'token_expired',
  'not_active',
  'too_many',
  'uncertain',
  'generic',
]);

/** True when `portal.errors` says this error; any other is the act's own sentence. */
export function isSharedPortalError(error: string): error is SharedPortalError {
  return SHARED.has(error);
}

/**
 * The sentence for a shared portal failure, with `t = useTranslations('portal.errors')`.
 * An unknown failure hands the client its reference; a promise that never
 * answered says the connection failed, or the server did (with Next's digest).
 */
export function describePortalFailure(failure: ShownPortalFailure, t: Translate): string {
  if ('rejection' in failure) return describeRejection(failure.rejection, t);
  if (failure.error === 'generic') return describeFailure({ error: failure.error, reference: failure.reference }, t);
  return t(failure.error);
}
