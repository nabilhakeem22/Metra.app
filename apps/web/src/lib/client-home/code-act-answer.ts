// What a code-checked act's token function answered, as the app keeps it.
// PURE: the act wrappers' {code, attempts_left?, limit?, retry_after_seconds?}
// read strictly, so a code this build does not know is never success
// (./code-acts.ts runs the acts).
import type { CodeActRefusal, CodeAnswer } from './code-answers';

/** Every refusal the act wrappers answer, as the app keeps it. */
const ACT_REFUSALS = new Set<CodeActRefusal>([
  'code_unknown',
  'code_expired',
  'code_used',
  'code_locked',
  'wrong_target',
  'token_expired',
  'not_active',
  'wrong_state',
  'busy',
  'signing_closed',
  'link_expired',
  'contract_inactive',
]);

/**
 * An act wrapper's {code, attempts_left?, limit?, retry_after_seconds?} as
 * the app answers it. `invalid` (no delivery has the token, or the inner act
 * refused its input) and any code nobody sent are `token_invalid`, the
 * dead-link answer of every link page, so a newer function's code can never
 * read as success.
 */
export function codeAnswerOf(payload: unknown): CodeAnswer {
  const {
    code,
    attempts_left: attemptsLeft,
    limit,
    retry_after_seconds: retryAfterSeconds,
  } = (payload ?? {}) as { code?: unknown; attempts_left?: unknown; limit?: unknown; retry_after_seconds?: unknown };
  if (code === 'ok') return { ok: true, already: false };
  if (code === 'already') return { ok: true, already: true };
  if (code === 'code_wrong' && Number.isInteger(attemptsLeft)) {
    return { ok: false, error: 'code_wrong', attemptsLeft: attemptsLeft as number };
  }
  if (code === 'too_many' && limit === 'claims_hour' && Number.isInteger(retryAfterSeconds)) {
    return { ok: false, error: 'too_many', limit, retryAfterSeconds: retryAfterSeconds as number };
  }
  if (typeof code === 'string' && ACT_REFUSALS.has(code as CodeActRefusal)) {
    return { ok: false, error: code as CodeActRefusal };
  }
  return { ok: false, error: 'token_invalid' };
}
