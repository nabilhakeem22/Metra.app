'use client';

import { Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { ProjectStage } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { addStage } from '@/lib/project-stages/actions';
import { StageRow } from './stage-row';

export function StagesTab({
  projectId,
  stages,
  canManage,
}: {
  projectId: string;
  stages: ProjectStage[];
  canManage: boolean;
}) {
  const t = useTranslations('projects.profile.stages');
  const tss = useTranslations('projects.stageStatuses');
  const tt = useTranslations('projects');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState('');

  function fail(res: { ok: boolean; error?: ActionCode }) {
    toast({
      title: resolveActionError(res.error as ActionCode, te),
      variant: 'destructive',
    });
  }

  function onAdd() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const res = await addStage(
        locale.startsWith('ar')
          ? { projectId, nameAr: newName }
          : { projectId, nameEn: newName },
      );
      if (res.ok) {
        setNewName('');
        toast({ title: tt('toast.stageAdded') });
        router.refresh();
      } else fail(res);
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          {stages.length === 0 ? (
            <div className="py-4">
              <EmptyState title={t('empty')} />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-start font-medium">{t('name')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('status')}</th>
                  <th className="px-4 py-2 text-start font-medium">{t('progress')}</th>
                  {canManage && <th className="px-4 py-2" />}
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => (
                  <StageRow
                    key={s.id}
                    stage={s}
                    canManage={canManage}
                    locale={locale}
                    label={tss}
                    saveLabel={t('save')}
                    deleteLabel={t('delete')}
                    onSaved={() => {
                      toast({ title: tt('toast.stageSaved') });
                      router.refresh();
                    }}
                    onDeleted={() => {
                      toast({ title: tt('toast.stageDeleted') });
                      router.refresh();
                    }}
                    onFail={fail}
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {canManage && (
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAdd();
              }
            }}
            placeholder={t('newName')}
            aria-label={t('add')}
            className="max-w-xs"
          />
          <Button
            type="button"
            variant="outline"
            onClick={onAdd}
            disabled={pending || newName.trim() === ''}
          >
            <Plus className="size-4" aria-hidden />
            {t('add')}
          </Button>
        </div>
      )}
    </div>
  );
}
