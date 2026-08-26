'use client';

import { Loader2, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { ProjectStatus } from '@metra/db';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FieldHint } from '@/components/ui/field-hint';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { addProjectType } from '@/lib/project-types/actions';
import { updateProject } from '@/lib/projects/actions';
import { PROJECT_STATUSES } from '@/lib/projects/statuses';
import type { ProjectWithType } from '@/lib/projects/queries';

export interface DetailsOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
}

interface FormState {
  code: string;
  nameEn: string;
  nameAr: string;
  clientId: string;
  typeId: string;
  status: ProjectStatus;
  description: string;
  advancePct: string;
  retentionPct: string;
  city: string;
  address: string;
  notes: string;
}

export function DetailsTab({
  project,
  clientOptions,
  projectTypes,
  canManage,
}: {
  project: ProjectWithType;
  clientOptions: DetailsOption[];
  projectTypes: DetailsOption[];
  canManage: boolean;
}) {
  const t = useTranslations('projects');
  const tp = useTranslations('projects.profile.details');
  const th = useTranslations('hints.project');
  const te = useTranslations('errors');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newType, setNewType] = useState('');
  const [form, setForm] = useState<FormState>({
    code: project.code,
    nameEn: project.nameEn ?? '',
    nameAr: project.nameAr ?? '',
    clientId: project.clientId,
    typeId: project.typeId ?? '',
    status: project.status,
    description: project.description ?? '',
    advancePct: project.advancePct,
    retentionPct: project.retentionPct,
    city: project.city ?? '',
    address: project.address ?? '',
    notes: project.notes ?? '',
  });

  const set = (k: keyof FormState) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v }));
  const label = (o: DetailsOption) =>
    pickLocale({ nameAr: o.nameAr, nameEn: o.nameEn }, 'name', locale).value;
  // Radix Select forbids an empty-string item value, so "no type" (persisted as
  // '') rides a sentinel mapped back to '' when writing form state.
  const NO_TYPE = '__no_type__';

  function onAddType() {
    const name = newType.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await addProjectType(
        locale.startsWith('ar') ? { nameAr: name } : { nameEn: name },
      );
      if (res.ok) {
        setNewType('');
        toast({ title: t('toast.typeAdded') });
        router.refresh();
      } else {
        toast({
          title: resolveActionError(res.error as ActionCode, te),
          variant: 'destructive',
        });
      }
    });
  }

  function submit() {
    startTransition(async () => {
      const res = await updateProject({
        id: project.id,
        code: form.code,
        nameEn: form.nameEn || null,
        nameAr: form.nameAr || null,
        clientId: form.clientId,
        typeId: form.typeId || null,
        status: form.status,
        description: form.description || null,
        advancePct: form.advancePct || '0',
        retentionPct: form.retentionPct || '0',
        startDate: project.startDate,
        endDate: project.endDate,
        city: form.city || null,
        address: form.address || null,
        notes: form.notes || null,
      });
      toast(
        res.ok
          ? { title: tp('saved') }
          : {
              title: resolveActionError(res.error as ActionCode, te),
              variant: 'destructive',
            },
      );
    });
  }

  const field = (
    k: keyof FormState,
    lbl: string,
    opts?: { dir?: 'ltr' | 'rtl'; hint?: string; inputMode?: 'decimal' },
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`p-${k}`} className="flex items-center">
        {lbl}
        {opts?.hint && <FieldHint id={`p-${k}-hint`} hint={opts.hint} />}
      </Label>
      <Input
        id={`p-${k}`}
        dir={opts?.dir ?? 'ltr'}
        inputMode={opts?.inputMode}
        aria-describedby={opts?.hint ? `p-${k}-hint` : undefined}
        value={form[k]}
        onChange={(e) => set(k)(e.target.value)}
        disabled={!canManage || pending}
      />
    </div>
  );

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('code', t('form.code'), { hint: th('code') })}
          <div className="space-y-2">
            <Label htmlFor="p-client" className="flex items-center">
              {t('form.client')}
              <FieldHint id="p-client-hint" hint={th('client')} />
            </Label>
            <Select
              value={form.clientId}
              onValueChange={(v) => set('clientId')(v)}
              disabled={!canManage || pending}
            >
              <SelectTrigger id="p-client" aria-describedby="p-client-hint">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {clientOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {label(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('nameEn', t('form.nameEn'), { hint: th('name') })}
          {field('nameAr', t('form.nameAr'), { dir: 'rtl', hint: th('name') })}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="p-type" className="flex items-center">
              {tp('type')}
              <FieldHint id="p-type-hint" hint={th('type')} />
            </Label>
            <Select
              value={form.typeId || NO_TYPE}
              onValueChange={(v) => set('typeId')(v === NO_TYPE ? '' : v)}
              disabled={!canManage || pending}
            >
              <SelectTrigger id="p-type" aria-describedby="p-type-hint">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TYPE}>{t('profile.noType')}</SelectItem>
                {projectTypes.map((ty) => (
                  <SelectItem key={ty.id} value={ty.id}>
                    {label(ty)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canManage && (
              <div className="flex items-center gap-1">
                <Input
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      onAddType();
                    }
                  }}
                  placeholder={tp('addTypePlaceholder')}
                  aria-label={tp('addType')}
                  className="h-9"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onAddType}
                  disabled={pending || newType.trim() === ''}
                >
                  <Plus className="size-4" aria-hidden />
                  {tp('addType')}
                </Button>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-status" className="flex items-center">
              {t('form.status')}
              <FieldHint id="p-status-hint" hint={th('status')} />
            </Label>
            <Select
              value={form.status}
              onValueChange={(v) => set('status')(v)}
              disabled={!canManage || pending}
            >
              <SelectTrigger id="p-status" aria-describedby="p-status-hint">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {t(`statuses.${s}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('advancePct', tp('advancePct'), { hint: th('advancePct'), inputMode: 'decimal' })}
          {field('retentionPct', tp('retentionPct'), { hint: th('retentionPct'), inputMode: 'decimal' })}
        </div>

        <div className="space-y-2">
          <Label htmlFor="p-description" className="flex items-center">
            {tp('description')}
            <FieldHint id="p-description-hint" hint={th('description')} />
          </Label>
          <textarea
            id="p-description"
            rows={3}
            aria-describedby="p-description-hint"
            className="w-full glass-field outline-none focus-ring-brand focus-visible:border-[color:hsl(var(--brand))] p-2 text-sm"
            value={form.description}
            onChange={(e) => set('description')(e.target.value)}
            disabled={!canManage || pending}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {field('city', t('form.city'))}
          {field('address', t('form.address'))}
        </div>
        {field('notes', t('form.notes'))}

        {canManage && (
          <div className="flex justify-end">
            <Button type="button" onClick={submit} disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {tp('save')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
