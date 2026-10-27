'use client';

import { MailWarning } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { NoEmailAct } from '@/lib/engagements/no-email-notice';

/** The line for each act a missing email blocks. */
const NOTICE_KEY: Readonly<Record<NoEmailAct, 'noEmailPayment' | 'noEmailSignature'>> = {
  payment: 'noEmailPayment',
  signature: 'noEmailSignature',
};

/**
 * The one line the cockpit card shows while the client must pay, or sign the
 * contract, and has no email on file (lib/engagements/no-email-notice.ts says
 * when): they cannot do it online, because the code it needs has nowhere to
 * go. Egyptian copy; the studio adds the email to the client's details.
 */
export function NoEmailNotice({ act }: { act: NoEmailAct }) {
  const t = useTranslations('engagements.command');
  return (
    <p
      data-no-email-notice
      className="flex items-start gap-2 rounded-item border border-[color:var(--warn-tint)] bg-[color:var(--track)] px-3 py-2.5 text-small text-[color:var(--text)]"
    >
      <MailWarning className="mt-0.5 size-4 shrink-0 text-[color:var(--warn)]" aria-hidden />
      {t(NOTICE_KEY[act])}
    </p>
  );
}
