'use client';

import { Loader2, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import {
  createDocumentCategory,
  updateDocumentCategory,
} from '@/lib/document-categories/actions';
import { pickLocale } from '@/lib/i18n/pick-locale';

export interface DocumentCategoryRow {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  active: boolean;
}

/**
 * Settings — the firm's document filing vocabulary. Each org starts from a default
 * set and can rename, add to, or retire it.
 *
 * RETIRE, NOT DELETE, and the copy says so: a retired category disappears from the
 * upload picker but every document already filed under it stays exactly where it is.
 * There is no delete control because there is no delete path — files reference these
 * rows, and a misclick must not be able to pull a category out from under them.
 */
export function DocumentCategoriesCard({
  categories,
}: {
  categories: DocumentCategoryRow[];
}) {
  const t = useTranslations('settings.documentCategories');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newAr, setNewAr] = useState('');
  const [newEn, setNewEn] = useState('');

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) {
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          done?.();
          router.refresh();
        } else {
          toast({
            title: resolveActionError(res.error as ActionCode, te),
            variant: 'destructive',
          });
        }
      } catch {
        toast({ title: te('generic'), variant: 'destructive' });
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div>
          <h2 className="text-sm font-semibold">{t('title')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>

        <ul className="divide-y rounded-md border">
          {categories.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span
                className={`flex-1 text-sm ${c.active ? '' : 'text-muted-foreground line-through'}`}
              >
                {pickLocale({ nameAr: c.nameAr, nameEn: c.nameEn }, 'name', locale).value}
              </span>
              {!c.active && (
                <span className="text-xs text-muted-foreground">{t('retired')}</span>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() =>
                  run(() =>
                    updateDocumentCategory({
                      id: c.id,
                      nameEn: c.nameEn,
                      nameAr: c.nameAr,
                      active: !c.active,
                    }),
                  )
                }
              >
                {t(c.active ? 'retire' : 'restore')}
              </Button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-40 flex-1 space-y-1.5">
            <Label htmlFor="dc-ar">{t('nameAr')}</Label>
            <Input
              id="dc-ar"
              dir="rtl"
              value={newAr}
              onChange={(e) => setNewAr(e.target.value)}
            />
          </div>
          <div className="min-w-40 flex-1 space-y-1.5">
            <Label htmlFor="dc-en">{t('nameEn')}</Label>
            <Input
              id="dc-en"
              dir="ltr"
              value={newEn}
              onChange={(e) => setNewEn(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={pending || (!newAr.trim() && !newEn.trim())}
            onClick={() =>
              run(
                () =>
                  createDocumentCategory({
                    nameAr: newAr.trim() || null,
                    nameEn: newEn.trim() || null,
                  }),
                () => {
                  setNewAr('');
                  setNewEn('');
                },
              )
            }
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {t('add')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('retireNote')}</p>
      </CardContent>
    </Card>
  );
}
