'use client';

import { Loader2, Plus } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { MAX_API_KEY_LABEL_LEN } from '@/lib/api-keys/field-rules';
import type { useApiKeyCreate } from './use-api-key-create';

// The "create API key" card: label field + mint button. The label, its
// refusal and Create live in useApiKeyCreate; this child is presentational.
export function ApiKeysCreateCard({
  t,
  creating,
}: {
  t: ReturnType<typeof useTranslations<'apiKeys'>>;
  creating: ReturnType<typeof useApiKeyCreate>;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(fieldRef, creating.errors.invalidAttempt);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('createTitle')}</CardTitle>
        <CardDescription>{t('createSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div ref={fieldRef} className="flex flex-wrap items-start gap-2">
          <div className="w-full max-w-xs">
            <FormField id="api-key-label" label={t('labelLabel')} {...creating.errors.bind('label')}>
              <Input
                value={creating.label}
                maxLength={MAX_API_KEY_LABEL_LEN}
                onChange={(e) => creating.setLabel(e.target.value)}
                placeholder={t('labelPlaceholder')}
              />
            </FormField>
          </div>
          <Button variant="default" className="mt-7" onClick={creating.create} disabled={creating.minting}>
            {creating.minting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            {t('create')}
          </Button>
        </div>
        {creating.errors.formError && (
          <p className="text-body text-destructive" role="alert">
            {creating.errors.formError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
