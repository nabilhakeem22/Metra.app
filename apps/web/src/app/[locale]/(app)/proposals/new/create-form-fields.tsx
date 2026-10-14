'use client';

import { useLocale, useTranslations } from 'next-intl';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import { pickLocale } from '@/lib/i18n/pick-locale';
import type { ProposalCreateField } from '@/lib/proposals/create-fields';

export interface Option {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
  code?: string;
  clientId?: string;
}

export interface CreateTyped {
  clientId: string;
  projectId: string;
  titleEn: string;
  titleAr: string;
  issueDate: string;
  expiryDate: string;
}

type Bind = (field: ProposalCreateField) => { error: string | undefined; onEdit: () => void };

/** The "New proposal" boxes. PRESENTATIONAL: the form owns the state and the rules. */
export function ProposalCreateFields({
  typed,
  set,
  clients,
  projects,
  bind,
}: {
  typed: CreateTyped;
  set: (key: keyof CreateTyped) => (value: string) => void;
  clients: Option[];
  projects: Option[];
  bind: Bind;
}) {
  const t = useTranslations('proposals');
  const locale = useLocale();
  const label = (o: Option) =>
    pickLocale({ nameAr: o.nameAr, nameEn: o.nameEn }, 'name', locale).value || o.code || o.id;
  const date = (key: 'issueDate' | 'expiryDate') => (
    <Input type="date" dir="ltr" value={typed[key]} onChange={(e) => set(key)(e.target.value)} />
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="np-client" label={t('create.client')} required {...bind('clientId')}>
          <SelectControl
            value={typed.clientId}
            onValueChange={set('clientId')}
            options={clients.map((c) => ({ value: c.id, label: label(c) }))}
          />
        </FormField>
        <FormField id="np-project" label={t('create.project')} required {...bind('projectId')}>
          <SelectControl
            value={typed.projectId}
            onValueChange={set('projectId')}
            options={projects.map((p) => ({ value: p.id, label: `${p.code ? `${p.code} · ` : ''}${label(p)}` }))}
          />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="np-titleEn" label={t('create.titleEn')}>
          <Input dir="ltr" value={typed.titleEn} onChange={(e) => set('titleEn')(e.target.value)} />
        </FormField>
        <FormField id="np-titleAr" label={t('create.titleAr')}>
          <Input dir="rtl" value={typed.titleAr} onChange={(e) => set('titleAr')(e.target.value)} />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField id="np-issue" label={t('create.issueDate')} {...bind('issueDate')}>
          {date('issueDate')}
        </FormField>
        <FormField id="np-expiry" label={t('create.expiryDate')} {...bind('expiryDate')}>
          {date('expiryDate')}
        </FormField>
      </div>
    </>
  );
}
