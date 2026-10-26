'use client';

import type { HomeTab } from '@/lib/client-home/tab';
import type { PublicDelivery } from '@/lib/engagements/public/types';
import { LanguageSwitch } from './language-switch';
import { StudioContact } from './studio-contact';
import { StudioMark } from './studio-mark';

/**
 * The studio bar across the top of the client page: the studio's logo (or its
 * initial), its name, its WhatsApp and Call buttons when it set a number, and
 * the language switch, on ONE row at 390 px (the name truncates before
 * anything wraps). Sticky, so the studio and the way to the other language
 * stay in reach while the client scrolls. As wide as the page under it (`wide`:
 * the Execution tab's two columns from lg up).
 */
export function StudioBar({
  firmName,
  firm,
  deliveryRef,
  token,
  locale,
  tab,
  wide = false,
}: {
  firmName: string;
  firm: Pick<PublicDelivery['firm'], 'hasLogo' | 'phone' | 'whatsappDigits'>;
  /** The delivery's reference (DE-YYYY-NNNN), the only thing a WhatsApp message names. */
  deliveryRef: string;
  token: string;
  locale: string;
  /** The tab the page shows, kept by the language switch and named in the studio's contact words; null for the current phase. */
  tab: HomeTab | null;
  wide?: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95">
      <div className={`mx-auto flex max-w-md items-center gap-2 px-4 py-2 ${wide ? 'lg:max-w-5xl' : ''}`}>
        <StudioMark firmName={firmName} hasLogo={firm.hasLogo} token={token} />
        <p className="ms-1 min-w-0 flex-1 truncate font-semibold leading-tight">
          <bdi>{firmName}</bdi>
        </p>
        <StudioContact
          phone={firm.phone}
          whatsappDigits={firm.whatsappDigits}
          deliveryRef={deliveryRef}
          phase={tab === 'execution' ? 'execution' : 'design'}
        />
        <LanguageSwitch token={token} locale={locale} tab={tab} />
      </div>
    </header>
  );
}
