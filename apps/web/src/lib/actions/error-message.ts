import type { ActionCode } from './result';

/**
 * The one mapper from an ActionResult error CODE to a localized string. Pass a
 * translator scoped to the `errors` namespace (useTranslations('errors')).
 * Unknown/absent codes fall back to `errors.generic`.
 */
export function resolveActionError(
  code: ActionCode | undefined,
  t: (key: string) => string,
): string {
  return t(code ?? 'generic');
}
