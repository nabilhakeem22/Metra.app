'use client';

import { Loader2, Plus } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MAX_API_KEY_LABEL_LEN } from '@/lib/api-keys/constants';

// The "create API key" card: label field + mint button. All state and the
// create handler live in the parent (ApiKeysClient); this child is
// presentational, driven by the passed value + callbacks.
export function ApiKeysCreateCard({
  t,
  label,
  setLabel,
  create,
  minting,
}: {
  t: ReturnType<typeof useTranslations<'apiKeys'>>;
  label: string;
  setLabel: (value: string) => void;
  create: () => void;
  minting: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('createTitle')}</CardTitle>
        <CardDescription>{t('createSubtitle')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="api-key-label">{t('labelLabel')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="api-key-label"
              value={label}
              maxLength={MAX_API_KEY_LABEL_LEN}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t('labelPlaceholder')}
              className="max-w-xs"
            />
            <Button onClick={create} disabled={minting || !label.trim()}>
              {minting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
              {t('create')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
