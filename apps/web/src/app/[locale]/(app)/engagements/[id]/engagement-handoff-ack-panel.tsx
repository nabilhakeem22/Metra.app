'use client';

import { useTranslations } from 'next-intl';
import { recordHandoffAcknowledgement } from '@/lib/engagements/actions';
import { AcknowledgementForm } from './acknowledgement-form';
import type { RunAction } from './run-action';

/**
 * Record the client's handover receipt ON THEIR BEHALF — the staff stand-in for
 * their own `acknowledge_handoff` token action, offered only while the engagement
 * sits at design_only_handoff.
 *
 * The sibling of the ROM-ack panel in every way that matters: it asserts somebody
 * else acted, so it lives in the Timeline header behind the same warning
 * treatment, and it owns its own note.
 */
export function HandoffAckPanel({
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
  const th = useTranslations('engagements.handoffAck');
  return (
    <div className="space-y-3 rounded-item border border-[color:var(--rule)] bg-[color:var(--track)] p-4">
      <p className="text-small text-[color:var(--text-muted)]">{th('hint')}</p>
      <p className="text-small font-medium">{th('closesDelivery')}</p>
      <AcknowledgementForm
        idPrefix="handoff-ack"
        record={(typed) => recordHandoffAcknowledgement({ engagementId, ...typed })}
        saveLabel={th('submit')}
        pending={pending}
        runAction={runAction}
        onDone={onDone}
      />
    </div>
  );
}
