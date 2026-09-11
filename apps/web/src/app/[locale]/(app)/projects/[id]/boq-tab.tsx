import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/empty-state';
import type { BoqDetail } from '@/lib/boqs/queries';
import { BoqCostedCopy } from './boq-costed-copy';
import { BoqIssue } from './boq-issue';
import { BoqSheet } from './boq-sheet';
import { BoqStart } from './boq-start';

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
}: {
  projectId: string;
  boq: BoqDetail | null;
  canBuild: boolean;
  /** Gates the costed copy, which carries the firm's margin. */
  canSeeCost: boolean;
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
      actions={
        <>
          {canSeeCost && <BoqCostedCopy boqId={boq.id} number={boq.number} />}
          {canEdit && <BoqIssue boqId={boq.id} disabled={boq.lineCount === 0} />}
        </>
      }
    />
  );
}
