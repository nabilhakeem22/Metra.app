// The failures every client link page (/d, /p, /c, /v) says the same way, from
// the shared `portal.errors` catalogue (فصحى). PURE and CLIENT-SAFE: the server
// actions build these, the pages render them.
import { describeFailure, type Translate } from '@/lib/actions/error-message';

/** Every key `portal.errors` holds for a failed act. */
export type SharedPortalError =
  | 'token_invalid'
  | 'token_expired'
  | 'not_active'
  | 'too_many'
  | 'comments_too_many'
  | 'uncertain'
  | 'generic';

/** A failure as a page keeps it for display. */
export type ShownPortalFailure = { error: SharedPortalError; reference?: string };

/**
 * A client WRITE whose request rejected (the answer never came back). It may
 * have reached the server and been saved, so it is never said as "could not
 * reach": the client is told to refresh and check before sending it again.
 * Only a READ (loading a thread) may say it failed outright.
 */
export const UNCONFIRMED_WRITE: ShownPortalFailure = { error: 'uncertain' };

const SHARED: ReadonlySet<string> = new Set<SharedPortalError>([
  'token_invalid',
  'token_expired',
  'not_active',
  'too_many',
  'comments_too_many',
  'uncertain',
  'generic',
]);

/** True when `portal.errors` says this error; any other is the act's own sentence. */
export function isSharedPortalError(error: string): error is SharedPortalError {
  return SHARED.has(error);
}

/**
 * The sentence for a shared portal failure, with `t = useTranslations('portal.errors')`.
 * An unknown failure hands the client its reference.
 */
export function describePortalFailure(failure: ShownPortalFailure, t: Translate): string {
  if (failure.error === 'generic') return describeFailure({ error: failure.error, reference: failure.reference }, t);
  return t(failure.error);
}

/**
 * The failure a link page's answer carries when the act never landed
 * (`uncertain`, or `generic` with its reference), or null when the answer is an
 * outcome the page says in its own words (a decision, a dead link).
 */
export function unansweredFailure(result: { ok: boolean; error?: string; reference?: string }): ShownPortalFailure | null {
  if (result.ok) return null;
  if (result.error === 'uncertain') return { error: result.error };
  if (result.error === 'generic') return { error: result.error, reference: result.reference };
  return null;
}
