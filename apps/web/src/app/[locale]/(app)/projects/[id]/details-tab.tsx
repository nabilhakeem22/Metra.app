'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import type { ProjectStatus } from '@metra/db';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ActionCode } from '@/lib/actions/result';
import { addProjectType } from '@/lib/project-types/actions';
import { updateProject } from '@/lib/projects/actions';
import type { ProjectWithType } from '@/lib/projects/queries';
import { DetailsFields } from './details-fields';

export interface DetailsOption {
  id: string;
  nameEn: string | null;
  nameAr: string | null;
}

export interface FormState {
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

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <DetailsFields
          t={t}
          tp={tp}
          th={th}
          locale={locale}
          form={form}
          set={set}
          canManage={canManage}
          pending={pending}
          clientOptions={clientOptions}
          projectTypes={projectTypes}
          newType={newType}
          setNewType={setNewType}
          onAddType={onAddType}
          submit={submit}
        />
      </CardContent>
    </Card>
  );
}
