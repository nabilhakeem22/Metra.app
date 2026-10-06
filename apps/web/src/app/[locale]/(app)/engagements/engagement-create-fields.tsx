'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ClientOption } from '@/lib/clients/queries';
import { pickLocale } from '@/lib/i18n/pick-locale';
import { FieldError, RequiredSelect } from './delivery-form-parts';
import type { ProjectOption } from './engagement-create-validation';

export interface DeliveryFormValues {
  titleEn: string;
  titleAr: string;
  clientId: string;
  projectId: string;
  offPlan: boolean;
}

/** The "Start delivery" fields. PRESENTATIONAL: the form owns the state and the rules. */
export function EngagementCreateFields({
  values,
  onChange,
  locked,
  clientOptions,
  projectsForClient,
  fieldErrors,
  projectHint,
}: {
  values: DeliveryFormValues;
  onChange: {
    titleEn: (value: string) => void;
    titleAr: (value: string) => void;
    clientId: (value: string) => void;
    projectId: (value: string) => void;
    offPlan: (value: boolean) => void;
  };
  /** Client and project are fixed by the caller (the through-project entry). */
  locked: boolean;
  clientOptions: ClientOption[];
  projectsForClient: ProjectOption[];
  /** Resolved refusal text, shown under the field it is about. */
  fieldErrors: { title?: string; client?: string; project?: string };
  /** Shown under the project select (e.g. the chosen client has no project yet). */
  projectHint?: ReactNode;
}) {
  const t = useTranslations('engagements.form');
  const locale = useLocale();
  const nameOf = (option: { id: string; nameAr: string | null; nameEn: string | null }) =>
    pickLocale({ nameAr: option.nameAr, nameEn: option.nameEn }, 'name', locale).value ||
    option.id.slice(0, 8);

  return (
    <>
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="eng-titleEn">{t('titleEn')}</Label>
            <Input
              id="eng-titleEn"
              dir="ltr"
              value={values.titleEn}
              onChange={(event) => onChange.titleEn(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="eng-titleAr">{t('titleAr')}</Label>
            <Input
              id="eng-titleAr"
              dir="rtl"
              value={values.titleAr}
              onChange={(event) => onChange.titleAr(event.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t('titleHint')}</p>
        <FieldError message={fieldErrors.title} />
      </div>

      {!locked && (
        <RequiredSelect
          id="eng-client"
          label={t('client')}
          placeholder={t('chooseClient')}
          value={values.clientId}
          onChange={onChange.clientId}
          options={clientOptions.map((client) => ({ id: client.id, name: nameOf(client) }))}
          error={fieldErrors.client}
        />
      )}

      {!locked && (
        <RequiredSelect
          id="eng-project"
          label={t('project')}
          placeholder={t('chooseProject')}
          value={values.projectId}
          onChange={onChange.projectId}
          options={projectsForClient.map((project) => ({ id: project.id, name: nameOf(project) }))}
          disabled={values.clientId === ''}
          hint={projectHint}
          error={fieldErrors.project}
        />
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.offPlan}
          onChange={(event) => onChange.offPlan(event.target.checked)}
        />
        {t('offPlan')}
      </label>
    </>
  );
}
