'use client';

import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { ProjectStage, StageStatus } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { formatPercent } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { addStage, deleteStage, updateStage } from '@/lib/project-stages/actions';

const STATUSES: StageStatus[] = [
  'not_started',
  'in_progress',
  'blocked',
  'done',
  'skipped',
];

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

function StageRow({
  stage,
  canManage,
  locale,
  label,
  saveLabel,
  deleteLabel,
  onSaved,
  onDeleted,
  onFail,
}: {
  stage: ProjectStage;
  canManage: boolean;
  locale: string;
  label: (k: string) => string;
  saveLabel: string;
  deleteLabel: string;
  onSaved: () => void;
  onDeleted: () => void;
  onFail: (res: { ok: boolean; error?: ActionCode }) => void;
}) {
  const [status, setStatus] = useState<StageStatus>(stage.status);
  const [progress, setProgress] = useState(stage.progressPct);
  const [pending, startTransition] = useTransition();
  const name = pickLocale(
    { nameAr: stage.nameAr, nameEn: stage.nameEn },
    'name',
    locale,
  ).value;
  const dirty = status !== stage.status || progress !== stage.progressPct;

  function save() {
    startTransition(async () => {
      const res = await updateStage({ id: stage.id, status, progressPct: progress });
      if (res.ok) onSaved();
      else onFail(res);
    });
  }
  function remove() {
    startTransition(async () => {
      const res = await deleteStage(stage.id);
      if (res.ok) onDeleted();
      else onFail(res);
    });
  }

  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-2">{name}</td>
      <td className="px-4 py-2">
        {canManage ? (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StageStatus)}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            aria-label={label(status)}
          >
            {STATUSES.map((st) => (
              <option key={st} value={st}>
                {label(st)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-muted-foreground">{label(status)}</span>
        )}
      </td>
      <td className="px-4 py-2">
        {canManage ? (
          <Input
            dir="ltr"
            inputMode="decimal"
            value={progress}
            onChange={(e) => setProgress(e.target.value)}
            className="h-9 w-20"
          />
        ) : (
          <span dir="ltr">{formatPercent(progress, locale)}</span>
        )}
      </td>
      {canManage && (
        <td className="px-4 py-2">
          <div className="flex items-center justify-end gap-1">
            {dirty && (
              <Button type="button" size="sm" onClick={save} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
                {saveLabel}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={deleteLabel}
              onClick={remove}
              disabled={pending}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        </td>
      )}
    </tr>
  );
}
