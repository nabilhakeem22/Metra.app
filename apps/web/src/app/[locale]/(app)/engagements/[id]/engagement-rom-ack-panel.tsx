'use client';

import { useTranslations } from 'next-intl';
import { recordRomAcknowledgement } from '@/lib/engagements/actions';
import { AcknowledgementForm } from './acknowledgement-form';
import type { RunAction } from './run-action';

/**
 * Record the client's cost-range acknowledgement ON THEIR BEHALF — for one they
 * gave on a call, in a message, or on paper.
 *
 * This is the only action in the cockpit that asserts SOMEBODY ELSE acted, which
 * is why it lives in the Timeline header rather than beside "attach a drawing",
 * and why its trigger is drawn as a warning rather than a button like any other.
 * It owns its own note (see the artifact panel for why the lifted-state era
 * ended).
 */
export function RomAckPanel({
  engagementId,
  pending,
  runAction,
  onDone,
}: {
  engagementId: string;
  pending: boolean;
  runAction: RunAction;
  onDone: () => void;
}) {
  const t = useTranslations('engagements.controls');
  return (
    <div className="rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <AcknowledgementForm
        idPrefix="rom-ack"
        record={(typed) => recordRomAcknowledgement({ engagementId, ...typed })}
        saveLabel={t('save')}
        pending={pending}
        runAction={runAction}
        onDone={onDone}
      />
    </div>
  );
}
