'use client';

import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import type { useConfirm } from '@/components/ui/confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { describeFailure, describeRejection } from '@/lib/actions/error-message';
import { revokeApiKey } from '@/lib/api-keys/actions';
import type { ApiKeyListRow } from '@/lib/api-keys/queries';

type Confirm = ReturnType<typeof useConfirm>['confirm'];

/**
 * Revoke one key, confirmed. A row has no field to say a refusal under, so the
 * toast names the cause (D11).
 */
export function useApiKeyRevoke(confirm: Confirm, onRevoked: (id: string) => void) {
  const t = useTranslations('apiKeys');
  const te = useTranslations('errors');
  const [revoking, startRevoke] = useTransition();

  // The confirm is awaited OUTSIDE the transition, and only the server action is
  // wrapped. Asking inside one deadlocks: React holds a pending transition's
  // updates back, so the dialog never paints, and the transition cannot finish
  // because it is waiting on that dialog.
  async function revoke(key: ApiKeyListRow) {
    const confirmed = await confirm({
      title: t('revokeConfirmTitle'),
      description: t('revokeConfirmBody', { label: key.label }),
      confirmLabel: t('revoke'),
      cancelLabel: t('cancel'),
      variant: 'destructive',
    });
    if (!confirmed) return;
    startRevoke(async () => {
      try {
        const result = await revokeApiKey(key.id);
        if (!result.ok) {
          toast({ title: describeFailure(result, te), variant: 'destructive' });
          return;
        }
        onRevoked(key.id);
        toast({ title: t('revoked') });
      } catch (rejection) {
        toast({ title: describeRejection(rejection, te), variant: 'destructive' });
      }
    });
  }

  return { revoke, revoking };
}
