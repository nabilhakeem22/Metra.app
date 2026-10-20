import { useTranslations } from 'next-intl';
import { EmptyState } from '@/components/ui/empty-state';
import type { BoqDetail } from '@/lib/boqs/queries';
import { BoqStart } from './boq-start';
import { BoqTabSheet } from './boq-tab-sheet';

/**
 * The project's Bill of Quantities — the priced schedule of works that the
 * execution phase measures against.
 *
 * The tab decides WHAT the studio may do; `BoqSheet` decides how the document
 * reads. Editing is offered only on a draft the signed-in role may build, and
 * refused server-side regardless (lib/boqs/edit.ts re-checks the status and the
 * capability on every write) — hiding the inputs on an issued BOQ is a courtesy
 * to the studio, not the rule that protects the document.
 *
 * A SERVER component, so it hands `BoqTabSheet` plain data only: the header
 * controls are a function of the BOQ as shown, and that function has to be made
 * on the client side of the boundary (src/test/no-function-props-to-client.test.ts).
 */
export function BoqTab({
  projectId,
  boq,
  canBuild,
  canSeeCost,
  clientCanOpenOnIssue,
}: {
  projectId: string;
  boq: BoqDetail | null;
  canBuild: boolean;
  /** Gates the costed copy, which carries the firm's margin. */
  canSeeCost: boolean;
  /** The portal's BOQ rule on the engagement an issue would deliver through:
   *  decides which sentence the Issue confirm says. */
  clientCanOpenOnIssue: boolean;
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
    <BoqTabSheet
      boq={boq}
      canEdit={canEdit}
      canSeeCost={canSeeCost}
      clientCanOpenOnIssue={clientCanOpenOnIssue}
    />
  );
}
