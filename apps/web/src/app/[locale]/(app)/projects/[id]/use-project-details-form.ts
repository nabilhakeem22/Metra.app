'use client';

import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { ProjectStatus } from '@metra/db';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { updateProject } from '@/lib/projects/actions';
import { projectFieldErrors } from '@/lib/projects/field-rules';
import type { ProjectField } from '@/lib/projects/fields';
import type { ProjectWithType } from '@/lib/projects/queries';

/** The project Details tab's boxes, as it holds them. */
export interface ProjectDetailsDraft {
  code: string;
  nameEn: string;
  nameAr: string;
  clientId: string;
  typeId: string;
  status: ProjectStatus;
  description: string;
  city: string;
  country: string;
  address: string;
  notes: string;
}

/** The refusals this tab says under a field; the dates live on the Schedule. */
export const PROJECT_DETAILS_FIELDS = [
  'code',
  'name',
  'nameEn',
  'nameAr',
  'clientId',
  'typeId',
  'description',
  'city',
  'country',
  'address',
  'notes',
] as const satisfies readonly ProjectField[];

function draftOf(project: ProjectWithType): ProjectDetailsDraft {
  return {
    code: project.code,
    nameEn: project.nameEn ?? '',
    nameAr: project.nameAr ?? '',
    clientId: project.clientId,
    typeId: project.typeId ?? '',
    status: project.status,
    description: project.description ?? '',
    city: project.city ?? '',
    country: project.country ?? '',
    address: project.address ?? '',
    notes: project.notes ?? '',
  };
}

/**
 * The Details tab's state and Save: the same rules as the project sheet,
 * checked before sending and said under each field. The percentages are not
 * sent (they live on Financials; updateProjectCore leaves them as they were).
 */
export function useProjectDetailsForm(project: ProjectWithType) {
  const tp = useTranslations('projects.profile.details');
  const te = useTranslations('errors');
  const [form, setForm] = useState<ProjectDetailsDraft>(() => draftOf(project));
  const [saving, startSaving] = useTransition();
  const errors = useFieldErrors({ fields: PROJECT_DETAILS_FIELDS, translate: te });

  function set<K extends keyof ProjectDetailsDraft>(key: K, value: ProjectDetailsDraft[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function save() {
    const payload = {
      code: form.code,
      nameEn: form.nameEn || null,
      nameAr: form.nameAr || null,
      clientId: form.clientId,
      typeId: form.typeId || null,
      status: form.status,
      description: form.description || null,
      startDate: project.startDate,
      endDate: project.endDate,
      city: form.city || null,
      country: form.country || null,
      address: form.address || null,
      notes: form.notes || null,
    };
    if (errors.applyLocal(projectFieldErrors(payload, { requireCode: true }))) return;
    startSaving(async () => {
      try {
        const result = await updateProject({ id: project.id, ...payload });
        if (!errors.applyResult(result)) toast({ title: tp('saved') });
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return { form, set, save, saving, errors };
}
