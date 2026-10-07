'use client';

import { Send, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { OverflowMenu } from '@/components/ui/overflow-menu';
import { BuilderSaveStatus } from './builder-save-status';
import { PreviewModal } from './preview-modal';
import type { DraftAutosaveApi } from './use-draft-autosave';

/**
 * The builder's actions, held at the top of the column while it scrolls, with
 * where the autosave stands at its start. `mode: 'boq'` is the
 * delivery's BOQ working copy: no Delete, no quote Send, no PDF downloads in the
 * preview (the BOQ PDF is produced when it is sent), and the BOQ's own action
 * arrives as `children`.
 */
export function BuilderToolbar({
  mode,
  proposalId,
  seeMargin,
  canSend,
  busy,
  autosave,
  onDelete,
  onSend,
  children,
}: {
  mode: 'quote' | 'boq';
  proposalId: string;
  seeMargin: boolean;
  canSend: boolean;
  /** Anything in the builder is in flight: every control here is disabled. */
  busy: boolean;
  autosave: DraftAutosaveApi;
  onDelete: () => void;
  onSend: () => void;
  children?: ReactNode;
}) {
  const t = useTranslations('proposals');
  const tc = useTranslations('common');
  const quote = mode === 'quote';

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center justify-end gap-2 rounded-panel border border-[color:var(--rule)] bg-card px-3 py-2 shadow-sm">
      <div className="me-auto">
        <BuilderSaveStatus autosave={autosave} />
      </div>
      <PreviewModal
        proposalId={proposalId}
        canSeeInternal={seeMargin}
        canSend={quote && canSend}
        downloadable={quote}
        disabled={busy}
        isDraft
      />
      {quote && canSend && (
        <Button variant="default" onClick={onSend} disabled={busy}>
          <Send className="size-4" aria-hidden />
          {t('builder.send')}
        </Button>
      )}
      {children}
      {/* Deleting the draft lives in the toolbar's menu, behind its confirm. */}
      {quote && (
        <OverflowMenu
          label={tc('moreActions')}
          disabled={busy}
          actions={[
            {
              key: 'delete',
              label: t('builder.delete'),
              icon: Trash2,
              destructive: true,
              onSelect: onDelete,
            },
          ]}
        />
      )}
    </div>
  );
}
