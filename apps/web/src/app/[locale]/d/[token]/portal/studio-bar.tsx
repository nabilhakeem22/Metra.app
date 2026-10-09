'use client';

import { LanguageSwitch } from './language-switch';

/**
 * The studio bar across the top of the client page: the studio's initial
 * mark, its name, and the language switch, on ONE row at 390 px (the name
 * truncates before anything wraps). Sticky, so the studio and the way to the
 * other language stay in reach while the client scrolls.
 *
 * Wave 3 adds the studio's logo (in place of the initial) and its WhatsApp and
 * call buttons; `token` and `locale` are what the logo route needs.
 */
export function StudioBar({
  firmName,
  token,
  locale,
}: {
  firmName: string;
  token: string;
  locale: string;
}) {
  const initial = firmName.trim().charAt(0) || 'M';
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95">
      <div className="mx-auto flex max-w-md items-center gap-3 px-4 py-2">
        <div
          className="flex size-10 shrink-0 items-center justify-center rounded-item bg-primary/10 text-title font-bold text-primary"
          aria-hidden
        >
          {initial}
        </div>
        <p className="min-w-0 flex-1 truncate font-semibold leading-tight">
          <bdi>{firmName}</bdi>
        </p>
        <LanguageSwitch token={token} locale={locale} />
      </div>
    </header>
  );
}
