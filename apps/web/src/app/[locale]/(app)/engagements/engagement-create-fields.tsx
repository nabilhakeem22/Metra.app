'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { SelectControl } from '@/components/ui/select-control';
import type { ClientOption } from '@/lib/clients/queries';
import { pickLocale } from '@/lib/i18n/pick-locale';
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
        {/* One title is enough, so a refused title is said once, under the
            first, and marks both. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormField id="eng-titleEn" label={t('titleEn')} error={fieldErrors.title}>
            <Input
              dir="ltr"
              value={values.titleEn}
              onChange={(event) => onChange.titleEn(event.target.value)}
            />
          </FormField>
          <FormField id="eng-titleAr" label={t('titleAr')}>
            <Input
              dir="rtl"
              aria-invalid={fieldErrors.title ? true : undefined}
              aria-describedby={fieldErrors.title ? 'eng-titleEn-error' : undefined}
              value={values.titleAr}
              onChange={(event) => onChange.titleAr(event.target.value)}
            />
          </FormField>
        </div>
        <p className="text-caption text-muted-foreground">{t('titleHint')}</p>
      </div>

      {!locked && (
        <FormField id="eng-client" label={t('client')} required error={fieldErrors.client}>
          <SelectControl
            value={values.clientId}
            onValueChange={onChange.clientId}
            placeholder={t('chooseClient')}
            options={clientOptions.map((client) => ({ value: client.id, label: nameOf(client) }))}
          />
        </FormField>
      )}

      {!locked && (
        <div className="space-y-2">
          <FormField id="eng-project" label={t('project')} required error={fieldErrors.project}>
            <SelectControl
              value={values.projectId}
              onValueChange={onChange.projectId}
              placeholder={t('chooseProject')}
              disabled={values.clientId === ''}
              options={projectsForClient.map((project) => ({
                value: project.id,
                label: nameOf(project),
              }))}
            />
          </FormField>
          {projectHint}
        </div>
      )}

      <label className="flex items-center gap-2 text-body">
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
