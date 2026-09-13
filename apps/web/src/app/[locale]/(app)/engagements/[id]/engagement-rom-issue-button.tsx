'use client';

import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import { issueRom } from '@/lib/engagements/actions';

/**
 * Send the current build-cost band to the client. Rendered only while there IS a
 * band and it has not been issued: setting a band is private working state, and
 * this is the act that puts the figure in front of the end client, so it is a
 * separate, owner/admin control rather than a side effect of typing a number.
 * Any later edit un-issues the band and this button comes back.
 */
export function RomIssueButton({
  engagementId,
  pending,
  runAction,
}: {
  engagementId: string;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
}) {
  const tpa = useTranslations('engagements.panelActions');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-[12.5px] text-[color:var(--text-muted)]">
        {tpa('issueRomHint')}
      </p>
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => runAction(() => issueRom(engagementId))}
      >
        <Send className="size-4" aria-hidden />
        {tpa('issueRom')}
      </Button>
    </div>
  );
}
