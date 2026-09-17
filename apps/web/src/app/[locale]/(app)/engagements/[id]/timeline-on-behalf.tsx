'use client';

import { UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/actions/result';
import { HandoffAckPanel } from './engagement-handoff-ack-panel';
import { RomAckPanel } from './engagement-rom-ack-panel';

// The ONE action in this cockpit that asserts somebody ELSE acted: recording a
// client acknowledgement the studio took offline. It is drawn as a WARNING rather
// than as a peer of "attach a drawing" — which is exactly what it looked like in
// the old strip, one identical tile among four.

export type OnBehalfPanel = 'rom' | 'handoff';

const DANGER_BUTTON =
  'border-[color:var(--danger)] text-[color:var(--danger)] disabled:border-[color:var(--rule)] disabled:text-[color:var(--text-faint)]';

export interface OnBehalfAvailability {
  canRecordRomAck: boolean;
  canRecordHandoffAck: boolean;
  /**
   * THE ONE GENUINE ELIGIBILITY CASE ON THIS PAGE.
   * `recordRomAcknowledgementCore` refuses with `rom_not_set` when no band exists
   * and `rom_not_issued` while the client has not been shown it — you cannot
   * acknowledge a range nobody entered, nor one nobody sent. So the control stays
   * on the page and says why, rather than firing into a coded error the studio
   * has to interpret. The blocked state is the teaching moment: it names the act
   * that unblocks it.
   */
  romAckBlocked: boolean;
}

/** The two danger buttons in the panel header. */
export function OnBehalfActions({
  availability,
  openPanel,
  pending,
  onToggle,
}: {
  availability: OnBehalfAvailability;
  openPanel: OnBehalfPanel | null;
  pending: boolean;
  onToggle: (panel: OnBehalfPanel) => void;
}) {
  const tpa = useTranslations('engagements.panelActions');
  const tha = useTranslations('engagements.handoffAck');
  return (
    <>
      {availability.canRecordRomAck && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={DANGER_BUTTON}
          disabled={pending || availability.romAckBlocked}
          onClick={() => onToggle('rom')}
          aria-expanded={openPanel === 'rom'}
        >
          <UserCheck className="size-4" aria-hidden />
          {tpa('onBehalf')}
        </Button>
      )}
      {availability.canRecordHandoffAck && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-[color:var(--danger)] text-[color:var(--danger)]"
          disabled={pending}
          onClick={() => onToggle('handoff')}
          aria-expanded={openPanel === 'handoff'}
        >
          <UserCheck className="size-4" aria-hidden />
          {tha('title')}
        </Button>
      )}
    </>
  );
}

/** The opened form, inside its warning box. */
export function OnBehalfPanelBox({
  panel,
  engagementId,
  pending,
  runAction,
  onDone,
}: {
  panel: OnBehalfPanel;
  engagementId: string;
  pending: boolean;
  runAction: (fn: () => Promise<ActionResult>) => void;
  onDone: () => void;
}) {
  const tpa = useTranslations('engagements.panelActions');
  return (
    <div className="mb-4 space-y-2.5 rounded-[var(--r-item)] border border-[color:var(--danger)] p-3.5">
      {/* Stated where the decision is made, not in a tooltip: this logs an
          acknowledgement AS the client, and the studio should read that sentence
          before the fields, every time. */}
      <p className="text-[12.5px] text-[color:var(--text)]">{tpa('onBehalfNote')}</p>
      {panel === 'rom' ? (
        <RomAckPanel
          engagementId={engagementId}
          pending={pending}
          runAction={runAction}
          onDone={onDone}
        />
      ) : (
        <HandoffAckPanel
          engagementId={engagementId}
          pending={pending}
          runAction={runAction}
          onDone={onDone}
        />
      )}
    </div>
  );
}
