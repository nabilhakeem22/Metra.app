import type { ReactNode } from 'react';
import { afterEach } from 'vitest';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import arEG from '@/messages/ar-EG.json';
import en from '@/messages/en.json';

// TEST-ONLY. Nothing under src/test is imported by product code, so none of this
// is ever bundled.
//
// There is deliberately NO `setupFiles` entry in vitest.config.ts: a setup file
// would run for all 123 node test files too and would need a `typeof document`
// guard. Instead this module registers `afterEach(cleanup)` at MODULE SCOPE, so
// the cost is paid exactly once per file that renders and never by a node file.
afterEach(cleanup);

export type TestLocale = 'ar-EG' | 'en';

type Catalogue = typeof arEG;

const CATALOGUES: Record<TestLocale, Catalogue> = {
  'ar-EG': arEG,
  en: en as Catalogue,
};

/**
 * A fixed instant, so a component that formats a date is deterministic across
 * machines and time zones. Paired with `timeZone: 'UTC'` on the provider.
 */
export const TEST_NOW = new Date('2026-06-15T12:00:00.000Z');

/** The catalogue the component under test is reading. */
export function messagesFor(locale: TestLocale): Catalogue {
  return CATALOGUES[locale];
}

/**
 * Resolve one key the way the component will:
 * `messageAt('ar-EG', 'errors.description_too_long')`.
 *
 * Throws if the key is absent. This is why no test in this suite ever types an
 * Arabic or English sentence into an assertion: a COPY edit must not red a test,
 * and a KEY deletion must.
 */
export function messageAt(locale: TestLocale, path: string): string {
  let node: unknown = CATALOGUES[locale];
  for (const segment of path.split('.')) {
    if (typeof node !== 'object' || node === null || !(segment in node)) {
      throw new Error(`messageAt: no key "${path}" in ${locale}`);
    }
    node = (node as Record<string, unknown>)[segment];
  }
  if (typeof node !== 'string') {
    throw new Error(`messageAt: "${path}" in ${locale} is not a leaf string`);
  }
  return node;
}

/**
 * Render a client component inside the REAL message catalogue.
 *
 * `onError` RETHROWS MISSING_MESSAGE so a key absent from the catalogue fails the
 * test instead of quietly rendering its own dotted path — the exact hole
 * stack-profile.md describes, where the parity check passes and the browser
 * throws. Every other next-intl error (an ICU formatting complaint, say) is
 * logged rather than thrown, because those are not the failure mode this suite
 * exists to catch.
 */
export function renderWithIntl(
  ui: ReactNode,
  options?: { locale?: TestLocale },
): RenderResult {
  const locale = options?.locale ?? 'ar-EG';
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={CATALOGUES[locale]}
      timeZone="UTC"
      now={TEST_NOW}
      onError={(error) => {
        if (error.code === 'MISSING_MESSAGE') throw error;
        console.error(error);
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}
