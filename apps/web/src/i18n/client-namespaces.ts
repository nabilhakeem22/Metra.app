import type { AbstractIntlMessages } from 'next-intl';

// Which message namespaces each part of the app hands the BROWSER.
//
// Every page used to serialise the whole catalogue (about 115 KB en, 150 KB
// ar-EG) into its HTML for NextIntlClientProvider, parse it again on the
// server, and ship it: about a third of the Worker CPU of /en/login (Round E,
// M4). Server components read the full catalogue on the server and send none of
// it; only client components read these.
//
// One scope per route segment that renders its own ScopedIntlProvider
// (./scoped-intl-provider.tsx). A nested provider REPLACES the outer one's
// messages, so each list is everything the client components under that
// segment use. The lists are derived, not guessed: client-namespaces.test.ts
// walks the imports of every route file into the client bundle and fails until
// each list equals what the client code there calls useTranslations with.
export const CLIENT_NAMESPACES = {
  /** app/[locale]/layout.tsx: the landing page and anything not scoped below. */
  root: ['app'],
  /** app/[locale]/(app): the studio. */
  studio: [
    'account', 'apiKeys', 'app', 'automation', 'clients', 'common', 'contracts', 'dashboard', 'delivery',
    'engagements', 'errors', 'help', 'hints', 'nav', 'notifications', 'onboarding', 'org', 'priceBook',
    'projects', 'proposals', 'roles', 'settings', 'shell', 'team', 'theme', 'tour', 'variations',
  ],
  /** app/[locale]/(auth): sign-in. */
  auth: ['app', 'common', 'errors', 'hints', 'home', 'login'],
  /** app/[locale]/onboarding. */
  onboarding: ['app', 'common', 'errors', 'hints', 'onboarding'],
  /** app/[locale]/invite: accepting a team invitation. */
  invite: ['accept', 'app'],
  /** app/[locale]/c: the client's contract link. */
  contractLink: ['contracts'],
  /** app/[locale]/d: the client's delivery page. */
  deliveryLink: ['app', 'delivery'],
  /** app/[locale]/p: the client's proposal link. */
  proposalLink: ['proposals'],
  /** app/[locale]/v: the client's variation link. */
  variationLink: ['variations'],
} as const satisfies Record<string, readonly string[]>;

export type MessageScope = keyof typeof CLIENT_NAMESPACES;

/** The part of `messages` the client components under `scope` read. */
export function scopedMessages(messages: AbstractIntlMessages, scope: MessageScope): AbstractIntlMessages {
  const scoped: AbstractIntlMessages = {};
  for (const namespace of CLIENT_NAMESPACES[scope]) {
    const value = messages[namespace];
    if (value !== undefined) scoped[namespace] = value;
  }
  return scoped;
}
