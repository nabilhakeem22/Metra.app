import type { AbstractIntlMessages } from 'next-intl';

// Which message namespaces each part of the app hands the BROWSER.
//
// Every page used to serialise the whole catalogue (about 115 KB en, 150 KB
// ar-EG) into its HTML for NextIntlClientProvider, parse it again on the
// server, and ship it: about a third of the Worker CPU of /en/login (Round E,
// M4). Server components read the full catalogue on the server and send none of
// it; only client components read these.
//
// An entry is a namespace or a dotted sub-tree of one ('proposals.p'): a client
// link page reads only its own sub-tree, so the studio's wording around it
// (margins, unit costs, internal approval) never reaches a client.
//
// One scope per route segment that renders its own ScopedIntlProvider
// (./scoped-intl-provider.tsx). A nested provider REPLACES the outer one's
// messages, so each list is everything the client components under that
// segment use. The lists are derived, not guessed: client-namespaces.test.ts
// walks the imports of every route file into the client bundle and fails until
// each list equals the sub-trees the client code there calls useTranslations
// with (less any that another one already contains).
/** The `errors` sub-trees a small route hands over instead of the whole
 *  catalogue (R5): exactly the codes its server actions can answer, which
 *  client-namespaces.test.ts proves by scanning everything the route loads. */
const errorsOf = (...keys: string[]) => keys.map((key) => `errors.${key}`);

const AUTH_ERRORS = errorsOf('check_fields', 'code_taken', 'field', 'generic', 'otp_email_unavailable', 'otp_rate_limited', 'otp_sms_unavailable', 'otp_verify_failed', 'phone_invalid', 'phone_required', 'reference', 'uncertain', 'unreachable');
const ONBOARDING_ERRORS = errorsOf('amount_too_large', 'busy', 'check_fields', 'code_taken', 'contract_exists', 'engagement_not_found', 'field', 'file_too_large', 'firm_type_unavailable', 'flow_not_enabled', 'forbidden', 'generic', 'immutable', 'logo_image_unsupported', 'name_required', 'phone_required', 'record_not_found', 'reference', 'storage_unavailable', 'uncertain', 'unreachable');
const INVITE_ERRORS = errorsOf('already_member', 'amount_too_large', 'busy', 'check_fields', 'code_taken', 'contract_exists', 'engagement_not_found', 'field', 'flow_not_enabled', 'forbidden', 'generic', 'immutable', 'invite_expired', 'invite_not_found', 'invite_wrong_account', 'last_owner', 'malformed', 'owner_immutable', 'pending_exists', 'record_not_found', 'reference', 'self', 'token_invalid', 'uncertain', 'unreachable');

export const CLIENT_NAMESPACES = {
  /** app/[locale]/layout.tsx: the landing page and anything not scoped below. */
  root: ['app'],
  /** app/[locale]/(app): the studio. */
  studio: [
    'account', 'apiKeys', 'app', 'automation', 'clients', 'common', 'contracts', 'dashboard.range',
    'delivery.share', 'engagements', 'errors', 'execution.card', 'help', 'hints.account', 'hints.client',
    'hints.costItem', 'hints.org', 'hints.priceBook', 'hints.project', 'hints.proposal', 'hints.team', 'nav', 'notifications',
    'onboarding', 'org', 'priceBook', 'projects', 'proposals', 'roles', 'settings', 'shell', 'team', 'theme',
    'tour', 'variations',
  ],
  /** app/[locale]/(auth): sign-in. */
  auth: ['app', 'common', ...AUTH_ERRORS, 'hints.auth', 'home', 'login'],
  /** app/[locale]/onboarding. */
  onboarding: ['app', 'common', ...ONBOARDING_ERRORS, 'hints.onboarding', 'onboarding'],
  /** app/[locale]/invite: accepting a team invitation. */
  invite: ['accept', 'app', ...INVITE_ERRORS],
  /** app/[locale]/c: the client's contract link. */
  contractLink: ['contracts.ack', 'portal.errors'],
  /** app/[locale]/d: the client's delivery page. */
  deliveryLink: ['app', 'delivery', 'portal.errors'],
  /** app/[locale]/p: the client's proposal link. */
  proposalLink: ['portal.errors', 'portal.units', 'proposals.p'],
  /** app/[locale]/v: the client's variation link. */
  variationLink: ['portal.errors', 'variations.client'],
} as const satisfies Record<string, readonly string[]>;

export type MessageScope = keyof typeof CLIENT_NAMESPACES;

function valueAt(messages: AbstractIntlMessages, path: readonly string[]): unknown {
  let node: unknown = messages;
  for (const segment of path) node = typeof node === 'object' && node !== null ? (node as AbstractIntlMessages)[segment] : undefined;
  return node;
}

/** The part of `messages` the client components under `scope` read: each listed
 *  sub-tree, under its own path. Never mutates `messages` (shared by every
 *  request): a parent object on the path is a fresh one. */
export function scopedMessages(messages: AbstractIntlMessages, scope: MessageScope): AbstractIntlMessages {
  const scoped: AbstractIntlMessages = {};
  namespaces: for (const namespace of CLIENT_NAMESPACES[scope]) {
    const path = namespace.split('.');
    // A sub-tree the catalogue does not hold adds nothing, not even its parents.
    if (valueAt(messages, path) === undefined) continue;
    const leaf = path.pop()!;
    let source: AbstractIntlMessages | undefined = messages;
    let target = scoped;
    for (const segment of path) {
      const next: unknown = source?.[segment];
      // A parent already copied whole holds this sub-tree: never write into it.
      if (next !== undefined && target[segment] === next) continue namespaces;
      source = typeof next === 'object' && next !== null ? (next as AbstractIntlMessages) : undefined;
      target = (target[segment] ??= {}) as AbstractIntlMessages;
    }
    const value = source?.[leaf];
    if (value !== undefined) target[leaf] = value;
  }
  return scoped;
}
