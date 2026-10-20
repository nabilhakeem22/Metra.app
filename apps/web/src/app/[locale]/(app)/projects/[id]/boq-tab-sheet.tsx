'use client';

import type { BoqDetail } from '@/lib/boqs/queries';
import { BoqCostedCopy } from './boq-costed-copy';
import { BoqIssue } from './boq-issue';
import { BoqSheet } from './boq-sheet';

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
}: {
  boq: BoqDetail;
  canEdit: boolean;
  canSeeCost: boolean;
  clientCanOpenOnIssue: boolean;
}) {
  return (
    <BoqSheet
      boq={boq}
      canEdit={canEdit}
      actions={(shown) => (
        <>
          {canSeeCost && <BoqCostedCopy boqId={boq.id} documentNumber={boq.documentNumber} />}
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
