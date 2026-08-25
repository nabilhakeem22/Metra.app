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
  const selectClass =
    'h-10 w-full glass-field outline-none focus-ring-brand focus-visible:border-[color:hsl(var(--brand))] px-3 text-sm';

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
            <select
              id="p-client"
              className={selectClass}
              aria-describedby="p-client-hint"
              value={form.clientId}
              onChange={(e) => set('clientId')(e.target.value)}
              disabled={!canManage || pending}
            >
              {clientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {label(c)}
                </option>
              ))}
            </select>
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
            <select
              id="p-type"
              className={selectClass}
              aria-describedby="p-type-hint"
              value={form.typeId}
              onChange={(e) => set('typeId')(e.target.value)}
              disabled={!canManage || pending}
            >
              <option value="">{t('profile.noType')}</option>
              {projectTypes.map((ty) => (
                <option key={ty.id} value={ty.id}>
                  {label(ty)}
                </option>
              ))}
            </select>
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
            <select
              id="p-status"
              className={selectClass}
              aria-describedby="p-status-hint"
              value={form.status}
              onChange={(e) => set('status')(e.target.value)}
              disabled={!canManage || pending}
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`statuses.${s}`)}
                </option>
              ))}
            </select>
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
