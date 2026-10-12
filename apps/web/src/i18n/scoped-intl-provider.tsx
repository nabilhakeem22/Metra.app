import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { scopedMessages, type MessageScope } from './client-namespaces';

/**
 * NextIntlClientProvider with only the namespaces the client components under
 * this segment read (./client-namespaces.ts). A SERVER component: the full
 * catalogue stays on the server, and only the scoped part is serialised into
 * the page. Nested inside another one, it replaces that one's messages.
 */
export async function ScopedIntlProvider({ scope, children }: { scope: MessageScope; children: ReactNode }) {
  const messages = await getMessages();
  return <NextIntlClientProvider messages={scopedMessages(messages, scope)}>{children}</NextIntlClientProvider>;
}
