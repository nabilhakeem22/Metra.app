'use client';

import { BookText, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

/**
 * A price book with nothing in it — and the two ways to fill it.
 *
 * NOT a bare "no items" notice: an empty catalogue is the one state where the
 * studio needs the action more than the explanation, so both routes in (the
 * starter catalogue and an Excel import) are the empty state itself.
 */
export function PriceBookEmpty({
  canManage,
  pending,
  onLoadStarter,
  onImport,
}: {
  canManage: boolean;
  pending: boolean;
  onLoadStarter: () => void;
  onImport: () => void;
}) {
  const t = useTranslations('priceBook');
  return (
    <Card>
      <CardContent className="py-4">
        <EmptyState
          icon={<BookText className="size-6" aria-hidden />}
          title={t('empty.title')}
          description={t('empty.description')}
          action={
            canManage ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Button data-tour="price-book-new" onClick={onLoadStarter} disabled={pending}>
                  {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {t('empty.loadStarter')}
                </Button>
                <Button variant="outline" onClick={onImport}>
                  <Upload className="size-4" aria-hidden />
                  {t('empty.importExcel')}
                </Button>
              </div>
            ) : undefined
          }
        />
      </CardContent>
    </Card>
  );
}
