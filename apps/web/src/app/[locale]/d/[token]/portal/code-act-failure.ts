// What a code-checked act's refusal that is NOT about the code says on its
// row. PURE and CLIENT-SAFE. A refusal about the code (wrong, spent, expired,
// locked, unknown, busy) is the code panel's (./use-client-code.ts) and never
// reaches here. A target that is not the act's, or a window that closed, is
// `wrong_state` (the thing moved on: the page shows where it stands); the rest
// are the shared portal failures every link page says.
import type { CodeAnswer } from '@/lib/client-home/code-answers';
import { actFailureOf, type ShownActFailure } from '@/lib/engagements/portal-error-key';

export function codeActFailureOf(answer: Exclude<CodeAnswer, { ok: true }>): ShownActFailure {
  switch (answer.error) {
    case 'wrong_target':
    case 'signing_closed':
    case 'link_expired':
      return { error: 'wrong_state' };
    default:
      return actFailureOf(answer);
  }
}
