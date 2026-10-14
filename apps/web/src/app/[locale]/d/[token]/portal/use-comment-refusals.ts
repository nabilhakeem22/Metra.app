'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { COMMENT_FIELDS, commentFieldErrors } from '@/lib/engagements/comment-field-rules';
import { actFailureOf, describeActFailure, type ShownActFailure } from '@/lib/engagements/portal-error-key';
import type { ThreadSendRefusals } from '@/lib/engagements/use-document-thread';
import type { DeliveryCommentActResult } from '../actions';

// Where the client's comment box says a refused send: a blank or too-long
// message under the box (checked before sending, and again by the server); any
// other failure (too many messages, a closed delivery, an unknown failure with
// its reference, a connection that dropped) in the line just below it.

export function useCommentRefusals() {
  const t = useTranslations('delivery.comments');
  const tErrors = useTranslations('portal.errors');
  const errors = useFieldErrors({ fields: COMMENT_FIELDS, translate: tErrors });
  const [failure, setFailure] = useState<ShownActFailure | null>(null);
  // The box's wrapper: a refusal under the box moves the caret into it.
  const boxRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(boxRef, errors.invalidAttempt);

  const refusals: ThreadSendRefusals<DeliveryCommentActResult> = {
    applyResult(result) {
      setFailure(null);
      if (result.ok) {
        errors.clear();
        return false;
      }
      if (result.error === 'check_fields') errors.applyLocal(result.fields);
      else {
        errors.clear();
        setFailure(actFailureOf(result));
      }
      return true;
    },
    applyRejection(rejection) {
      errors.clear();
      setFailure({ rejection });
    },
  };

  /** Say a blank or too-long draft under the box; true = do not send. */
  function precheck(draft: string): boolean {
    setFailure(null);
    return errors.applyLocal(commentFieldErrors(draft));
  }

  return {
    refusals,
    precheck,
    boxRef,
    bodyError: errors.messageFor('body'),
    onBodyEdit: errors.bind('body').onEdit,
    failureText: failure ? describeActFailure(failure, tErrors, () => t('error.wrong_state')) : null,
  };
}
