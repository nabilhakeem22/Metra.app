'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from '@/i18n/routing';
import type { ActionCode } from '@/lib/actions/result';
import { createEngagement } from '@/lib/engagements/actions';
import type { DeliveryFormValues } from './engagement-create-fields';
import {
  deliveryFieldFor,
  type DeliveryFormField,
  type ProjectNames,
  type ProjectOption,
} from './engagement-create-validation';

const EMPTY_VALUES: DeliveryFormValues = {
  titleEn: '',
  titleAr: '',
  clientId: '',
  projectId: '',
  offPlan: false,
};

/** The titles a project lends the delivery (empty when no project is chosen). */
function titlesOf(project: ProjectNames | undefined): Pick<DeliveryFormValues, 'titleEn' | 'titleAr'> {
  return { titleEn: project?.nameEn ?? '', titleAr: project?.nameAr ?? '' };
}

export interface DeliveryFormLock {
  clientId?: string;
  projectId?: string;
  projectName?: ProjectNames;
}

/**
 * The "Start delivery" form's state and submit. Nothing is chosen for the
 * studio: client and project start empty unless the caller locks them. The
 * title follows the chosen project until the studio types one. A refusal is
 * filed under the field it is about (above the form when the selects are hidden).
 */
export function useDeliveryForm(options: {
  open: boolean;
  projectOptions: ProjectOption[];
  lock: DeliveryFormLock;
  onCreated: () => void;
}) {
  const { open, projectOptions, lock, onCreated } = options;
  const router = useRouter();
  const locked = Boolean(lock.clientId && lock.projectId);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<{ code: ActionCode; field: DeliveryFormField } | null>(null);
  const [values, setValues] = useState<DeliveryFormValues>(EMPTY_VALUES);
  const [titleTyped, setTitleTyped] = useState(false);

  const projectsForClient = useMemo(
    () => projectOptions.filter((project) => project.clientId === values.clientId),
    [projectOptions, values.clientId],
  );

  // Primitive deps: a re-render that hands over an equal names object must not
  // reset what the studio has typed.
  const lockedNameEn = lock.projectName?.nameEn ?? null;
  const lockedNameAr = lock.projectName?.nameAr ?? null;
  useEffect(() => {
    if (!open) return;
    setError(null);
    setTitleTyped(false);
    setValues({
      ...EMPTY_VALUES,
      ...(locked ? titlesOf({ nameEn: lockedNameEn, nameAr: lockedNameAr }) : {}),
      clientId: lock.clientId ?? '',
      projectId: lock.projectId ?? '',
    });
  }, [open, locked, lock.clientId, lock.projectId, lockedNameEn, lockedNameAr]);

  const onChange = {
    titleEn: (titleEn: string) => {
      setTitleTyped(true);
      setValues((prev) => ({ ...prev, titleEn }));
    },
    titleAr: (titleAr: string) => {
      setTitleTyped(true);
      setValues((prev) => ({ ...prev, titleAr }));
    },
    clientId: (clientId: string) =>
      setValues((prev) => ({
        ...prev,
        clientId,
        projectId: '',
        ...(titleTyped ? {} : titlesOf(undefined)),
      })),
    projectId: (projectId: string) =>
      setValues((prev) => ({
        ...prev,
        projectId,
        ...(titleTyped ? {} : titlesOf(projectOptions.find((project) => project.id === projectId))),
      })),
    offPlan: (offPlan: boolean) => setValues((prev) => ({ ...prev, offPlan })),
  };

  function submit(): void {
    setError(null);
    startTransition(async () => {
      try {
        const res = await createEngagement({
          titleEn: values.titleEn || null,
          titleAr: values.titleAr || null,
          clientId: values.clientId,
          projectId: values.projectId,
          offPlan: values.offPlan,
        });
        if (res.ok && res.data) {
          onCreated();
          router.push(`/engagements/${res.data}`);
          return;
        }
        const code = (res.error as ActionCode) ?? 'generic';
        const field = deliveryFieldFor(code);
        setError({ code, field: locked && field !== 'title' ? 'form' : field });
      } catch {
        setError({ code: 'generic', field: 'form' });
      }
    });
  }

  return { values, onChange, projectsForClient, error, pending, submit, locked };
}
