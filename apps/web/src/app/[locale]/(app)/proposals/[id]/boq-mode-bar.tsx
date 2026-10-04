'use client';

import { ArrowLeft, Info, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import { persistDraft } from './persist-draft';
import type { ProposalDraftState } from './proposal-payload';

/**
 * The top of the builder in BOQ mode: the way back to the delivery, and the one
 * sentence that explains what this document is. "Back to delivery" SAVES first
 * and sends nothing; if the save is refused the studio stays on the draft.
 */
export function BoqModeBar({
  engagementId,
  draftState,
}: {
  engagementId: string;
  draftState: () => ProposalDraftState;
}) {
  const t = useTranslations('proposals.boqMode');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, start] = useTransition();

  function back(): void {
    start(async () => {
      try {
        const saved = await persistDraft(draftState());
        if (saved.ok) {
          router.push(`/engagements/${engagementId}`);
          return;
        }
        toast({ title: resolveActionError(saved.error, te), variant: 'destructive' });
      } catch {
        toast({ title: resolveActionError('generic', te), variant: 'destructive' });
      }
    });
  }

  return (
    <div className="space-y-3">
      <Button variant="ghost" size="sm" onClick={back} disabled={pending}>
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        )}
        {t('back')}
      </Button>
      <div className="flex items-start gap-2.5 rounded-[var(--r-panel)] border border-[color:var(--brand-tint-border)] bg-[color:var(--brand-tint)] px-4 py-3 text-[13.5px] text-[color:var(--text)]">
        <Info className="mt-0.5 size-4 shrink-0 text-brand-ink" aria-hidden />
        <p>{t('banner')}</p>
      </div>
    </div>
  );
}
