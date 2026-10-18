// From a failed action to the sentence a person reads. Pure, so the studio and
// the client portal share it: pass `useTranslations('errors')` in the studio and
// `useTranslations('portal.errors')` on a link page; both carry the same keys.
import type { MessageParams } from './field-errors';
import type { ActionCode, ActionResult } from './result';

/** A translator scoped to an errors namespace. */
export type Translate = (key: string, values?: MessageParams) => string;

/**
 * The one mapper from an ActionResult error CODE to a localized string.
 * Unknown/absent codes fall back to `generic`.
 */
export function resolveActionError(
  code: ActionCode | undefined,
  t: Translate,
  params?: MessageParams,
): string {
  return params ? t(code ?? 'generic', params) : t(code ?? 'generic');
}

/** `generic` followed by the sentence that hands the person its reference. */
function genericWithReference(reference: string, t: Translate): string {
  return `${t('generic')} ${t('reference', { reference })}`;
}

/**
 * A failed result as one sentence. An unknown failure that carries a reference
 * says so, so support can find its log line; any other code is its own message.
 */
export function describeFailure(
  result: Pick<ActionResult, 'error' | 'params' | 'reference'>,
  t: Translate,
): string {
  if (result.error === 'generic' && result.reference) {
    return genericWithReference(result.reference, t);
  }
  return resolveActionError(result.error, t, result.params);
}

/** Next attaches a `digest` to an error a server action threw; it finds the log line. */
function digestOf(rejection: unknown): string | undefined {
  if (rejection === null || typeof rejection !== 'object') return undefined;
  const digest = (rejection as { digest?: unknown }).digest;
  return typeof digest === 'string' && digest.length > 0 ? digest : undefined;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * A rejected action promise: the answer never came back as a result. A server
 * throw carries Next's digest, which works as a reference; a failed fetch (a
 * TypeError) or an offline browser never reached Metra at all.
 */
export function describeRejection(rejection: unknown, t: Translate): string {
  const digest = digestOf(rejection);
  if (digest) return genericWithReference(digest, t);
  if (rejection instanceof TypeError || isOffline()) return t('unreachable');
  return t('generic');
}

/** A failure kept for display: a coded answer, or a promise that never answered. */
export type ShownFailure = Pick<ActionResult, 'error' | 'params' | 'reference'> | { readonly rejection: unknown };

/** The sentence for a kept failure, whichever way it failed. */
export function describeShownFailure(failure: ShownFailure, t: Translate): string {
  return 'rejection' in failure ? describeRejection(failure.rejection, t) : describeFailure(failure, t);
}

/**
 * A failed READ as one sentence. As describeShownFailure, except that the
 * sentences written for a save ("what you entered is still here") give way to
 * `couldNotLoad`, since a load puts nothing the person typed at stake; a
 * reference, when there is one, still follows it. A coded refusal
 * (forbidden, record_not_found...) keeps its own message.
 */
export function describeReadFailure(failure: ShownFailure, t: Translate, couldNotLoad: string): string {
  const withReference = (reference: string | undefined) =>
    reference ? `${couldNotLoad} ${t('reference', { reference })}` : couldNotLoad;
  if ('rejection' in failure) return withReference(digestOf(failure.rejection));
  if (failure.error === undefined || failure.error === 'generic') return withReference(failure.reference);
  return resolveActionError(failure.error, t, failure.params);
}
