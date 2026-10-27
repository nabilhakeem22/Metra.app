'use client';

import { MailWarning } from 'lucide-react';
import { useTranslations } from 'next-intl';

/**
 * The one line the cockpit card shows while the client must pay and has no
 * email on file (lib/engagements/no-email-notice.ts says when): they cannot
 * report the payment online, because the code it needs has nowhere to go.
 * Egyptian copy; the studio adds the email on the client's page.
 */
export function NoEmailNotice() {
  const t = useTranslations('engagements.command');
  return (
    <p
      data-no-email-notice
      className="flex items-start gap-2 rounded-item border border-[color:var(--warn-tint)] bg-[color:var(--track)] px-3 py-2.5 text-small text-[color:var(--text)]"
    >
      <MailWarning className="mt-0.5 size-4 shrink-0 text-[color:var(--warn)]" aria-hidden />
      {t('noEmailPayment')}
    </p>
  );
}
