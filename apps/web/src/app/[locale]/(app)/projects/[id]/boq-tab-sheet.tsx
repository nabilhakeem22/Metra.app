'use client';

import { useTranslations } from 'next-intl';
import { DesignFirstLink } from '@/components/contracts/design-first-link';
import { GenerateExecutionContract } from '@/components/contracts/generate-execution-contract';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import { describeFailure } from '@/lib/actions/error-message';
import type { BoqDetail } from '@/lib/boqs/queries';
import type { DesignFirstRefusal } from '@/lib/engagements/design-first';
import { BoqCostedCopy } from './boq-costed-copy';
import { BoqIssue } from './boq-issue';
import { BoqSheet } from './boq-sheet';

/** What an issued BOQ offers for execution: its contract, or to create one. */
export interface BoqExecution {
  contractId: string | null;
  /** May generate an execution contract (`contracts_generate` create). */
  canGenerate: boolean;
  /** Why no Create button: the sentence and the link replace it. Null when none. */
  refusal: DesignFirstRefusal | { code: 'boq_not_on_home' } | null;
}

/** Why an issued BOQ cannot become a contract yet, and where to go next. */
function BoqExecutionRefusal({ refusal }: { refusal: NonNullable<BoqExecution['refusal']> }) {
  const te = useTranslations('errors');
  const params = 'params' in refusal ? refusal.params : undefined;
  return (
    <div className="w-full">
      <p className="text-body text-[color:var(--text-muted)]">{describeFailure({ error: refusal.code, params }, te)}</p>
      <DesignFirstLink target={params} />
    </div>
  );
}

/** An issued BOQ's way into execution: open its contract, create it, or why it cannot yet. */
function BoqExecutionAction({ execution, boqId }: { execution: BoqExecution; boqId: string }) {
  const t = useTranslations('contracts.execution.generate');
  if (execution.contractId) {
    return (
      <Button asChild variant="secondary">
        <Link href={`/contracts/${execution.contractId}`}>{t('openContract')}</Link>
      </Button>
    );
  }
  if (execution.refusal) return <BoqExecutionRefusal refusal={execution.refusal} />;
  return execution.canGenerate ? <GenerateExecutionContract boqId={boqId} /> : null;
}

/**
 * The sheet with the tab's controls in its header.
 *
 * A CLIENT component for one reason: `BoqSheet` takes its header controls as a
 * render-prop over the BOQ AS SHOWN, and a function cannot cross from a server
 * component into a client one — Next refuses the whole render ("Functions cannot
 * be passed directly to Client Components"). So the server tab hands this file
 * plain data, and the function is made here, on the client side of the line.
 */
export function BoqTabSheet({
  boq,
  canEdit,
  canSeeCost,
  clientCanOpenOnIssue,
  issueNeedsDelivery,
  issueBlockedByContract,
  execution,
}: {
  boq: BoqDetail;
  canEdit: boolean;
  canSeeCost: boolean;
  clientCanOpenOnIssue: boolean;
  issueNeedsDelivery: boolean;
  issueBlockedByContract: boolean;
  execution: BoqExecution;
}) {
  const t = useTranslations('projects.profile.boq');
  const te = useTranslations('errors');
  return (
    <BoqSheet
      boq={boq}
      canEdit={canEdit}
      actions={(shown) => (
        <>
          {canSeeCost && <BoqCostedCopy boqId={boq.id} documentNumber={boq.documentNumber} />}
          {boq.status === 'issued' && <BoqExecutionAction execution={execution} boqId={boq.id} />}
          {canEdit && issueBlockedByContract && (
            <p className="text-body text-[color:var(--text-muted)]">{t('issueBlockedByContract')}</p>
          )}
          {canEdit && issueNeedsDelivery && (
            <p className="text-body text-[color:var(--text-muted)]">{te('boq_needs_delivery')}</p>
          )}
          {canEdit && (
            <BoqIssue
              boqId={boq.id}
              disabled={shown.lineCount === 0 || issueBlockedByContract || issueNeedsDelivery}
              clientCanOpen={clientCanOpenOnIssue}
            />
          )}
        </>
      )}
    />
  );
}
