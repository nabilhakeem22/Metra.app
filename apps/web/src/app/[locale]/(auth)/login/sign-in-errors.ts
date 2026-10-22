import type { Translate } from '@/lib/actions/error-message';

// The sign-in routes answer two codes about the PAGE, not the person:
// `forbidden` (a missing or foreign Origin, a body not declared JSON) and
// `malformed` (a body they cannot read). The studio sentences for those codes
// talk about a workspace role, or about the page sending something odd; on the
// login page there is no workspace yet, and nobody to ask. Both read as one
// sign-in sentence here; every other code keeps its own. The studio's meaning
// of `forbidden` is unchanged.
const PAGE_REFUSALS: ReadonlySet<string> = new Set(['forbidden', 'malformed']);

/** The login form's translator for refusals: `errors`, with the page refusals as `pageRefused`. */
export function signInErrorTranslator(errors: Translate, pageRefused: string): Translate {
  return (key, values) => (PAGE_REFUSALS.has(key) ? pageRefused : errors(key, values));
}
