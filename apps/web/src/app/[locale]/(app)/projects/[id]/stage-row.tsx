'use client';

import { Loader2, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import type { ProjectStage, StageStatus } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ActionCode } from '@/lib/actions/result';
import { formatPercent } from '@/lib/format/number';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { deleteStage, updateStage } from '@/lib/project-stages/actions';

const STATUSES: StageStatus[] = [
  'not_started',
  'in_progress',
  'blocked',
  'done',
  'skipped',
];

export function StageRow({
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
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as StageStatus)}
          >
            <SelectTrigger className="h-9 w-auto min-w-32" aria-label={label(status)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((st) => (
                <SelectItem key={st} value={st}>
                  {label(st)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
