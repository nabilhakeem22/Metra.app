import { useTranslations } from 'next-intl';
import { GenerateExecutionContract } from '@/components/contracts/generate-execution-contract';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/routing';
import type { BoqDetail } from '@/lib/boqs/queries';
import { BoqCostedCopy } from './boq-costed-copy';
import { BoqIssue } from './boq-issue';
import { BoqSheet } from './boq-sheet';
import { BoqStart } from './boq-start';

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
 * The project's Bill of Quantities — the priced schedule of works that the
 * execution phase measures against.
 *
 * The tab decides WHAT the studio may do; `BoqSheet` decides how the document
 * reads. Editing is offered only on a draft the signed-in role may build, and
 * refused server-side regardless (lib/boqs/edit.ts re-checks the status and the
 * capability on every write) — hiding the inputs on an issued BOQ is a courtesy
 * to the studio, not the rule that protects the document.
 */
export function BoqTab({
  projectId,
  boq,
  canBuild,
  canSeeCost,
  clientCanOpenOnIssue,
  execution,
}: {
  projectId: string;
  boq: BoqDetail | null;
  canBuild: boolean;
  /** Gates the costed copy, which carries the firm's margin. */
  canSeeCost: boolean;
  /** The portal's BOQ rule on the engagement an issue would deliver through:
   *  decides which sentence the Issue confirm says. */
  clientCanOpenOnIssue: boolean;
  execution: BoqExecution;
}) {
  const t = useTranslations('projects.profile.boq');

  if (!boq) {
    return (
      <div className="space-y-4">
        <EmptyState title={t('emptyTitle')} description={t('emptyBody')} />
        {canBuild && <BoqStart projectId={projectId} />}
      </div>
    );
  }

  const canEdit = canBuild && boq.status === 'draft';

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
