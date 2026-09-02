'use client';

import { Loader2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
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
import { pickLocale } from '@/lib/i18n/pick-locale';
import { PROJECT_STATUSES } from '@/lib/projects/statuses';
import type { DetailsOption, FormState } from './details-tab';
import { DetailsTypeField } from './details-type-field';

// The project details field groups (code · client · names · type · status ·
// percentages · description · location · notes + save). All form state and
// mutations live in the parent (DetailsTab); this child is presentational,
// driven by `form` and the curried `set` updater.
export function DetailsFields({
  t,
  tp,
  th,
  locale,
  form,
  set,
  canManage,
  pending,
  clientOptions,
  projectTypes,
  newType,
  setNewType,
  onAddType,
  submit,
}: {
  t: ReturnType<typeof useTranslations<'projects'>>;
  tp: ReturnType<typeof useTranslations<'projects.profile.details'>>;
  th: ReturnType<typeof useTranslations<'hints.project'>>;
  locale: string;
  form: FormState;
  set: (k: keyof FormState) => (v: string) => void;
  canManage: boolean;
  pending: boolean;
  clientOptions: DetailsOption[];
  projectTypes: DetailsOption[];
  newType: string;
  setNewType: (value: string) => void;
  onAddType: () => void;
  submit: () => void;
}) {
  const label = (o: DetailsOption) =>
    pickLocale({ nameAr: o.nameAr, nameEn: o.nameEn }, 'name', locale).value;

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
    <>
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
        <DetailsTypeField
          t={t}
          tp={tp}
          th={th}
          typeId={form.typeId}
          onTypeIdChange={set('typeId')}
          projectTypes={projectTypes}
          label={label}
          canManage={canManage}
          pending={pending}
          newType={newType}
          setNewType={setNewType}
          onAddType={onAddType}
        />
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
        {field('country', t('form.country'))}
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
    </>
  );
}
