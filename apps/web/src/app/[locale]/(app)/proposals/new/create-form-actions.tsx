'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

/** The "New proposal" footer: a refusal that belongs to no field, Cancel, Create. */
export function CreateFormActions({
  formError,
  pending,
  onCancel,
  onSubmit,
}: {
  formError: string | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const t = useTranslations('proposals');
  return (
    <div className="space-y-2">
      {formError && (
        <p className="text-body text-destructive" role="alert">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={pending}>
          {t('create.cancel')}
        </Button>
        <Button variant="default" onClick={onSubmit} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {t('create.submit')}
        </Button>
      </div>
    </div>
  );
}
