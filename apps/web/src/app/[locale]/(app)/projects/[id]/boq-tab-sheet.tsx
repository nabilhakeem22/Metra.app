'use client';

import { useTranslations } from 'next-intl';
import { GenerateExecutionContract } from '@/components/contracts/generate-execution-contract';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';
import type { BoqDetail } from '@/lib/boqs/queries';
import { BoqCostedCopy } from './boq-costed-copy';
import { BoqIssue } from './boq-issue';
import { BoqSheet } from './boq-sheet';

/** What an issued BOQ offers for execution: its contract, or to create one. */
export interface BoqExecution {
  contractId: string | null;
  /** May generate an execution contract (`contracts_generate` create). */
  canGenerate: boolean;
}

/** An issued BOQ's way into execution: open its contract, or create it. */
function BoqExecutionAction({ execution, boqId }: { execution: BoqExecution; boqId: string }) {
  const t = useTranslations('contracts.execution.generate');
  if (execution.contractId) {
    return (
      <Button asChild variant="secondary">
        <Link href={`/contracts/${execution.contractId}`}>{t('openContract')}</Link>
      </Button>
    );
  }
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
  execution,
}: {
  boq: BoqDetail;
  canEdit: boolean;
  canSeeCost: boolean;
  clientCanOpenOnIssue: boolean;
  execution: BoqExecution;
}) {
  return (
    <BoqSheet
      boq={boq}
      canEdit={canEdit}
      actions={(shown) => (
        <>
          {canSeeCost && <BoqCostedCopy boqId={boq.id} documentNumber={boq.documentNumber} />}
          {boq.status === 'issued' && <BoqExecutionAction execution={execution} boqId={boq.id} />}
          {canEdit && (
            <BoqIssue
              boqId={boq.id}
              disabled={shown.lineCount === 0}
              clientCanOpen={clientCanOpenOnIssue}
            />
          )}
        </>
      )}
    />
  );
}
