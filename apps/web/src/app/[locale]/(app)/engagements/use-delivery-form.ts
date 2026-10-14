'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useRouter } from '@/i18n/routing';
import { invariant } from '@/lib/actions/invariant';
import { createEngagement } from '@/lib/engagements/actions';
import { engagementCreateFieldErrors } from '@/lib/engagements/create-field-rules';
import { ENGAGEMENT_CREATE_FIELDS } from '@/lib/engagements/create-fields';
import type { DeliveryFormValues } from './engagement-create-fields';
import type { ProjectNames, ProjectOption } from './delivery-options';

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

/** While the caller locks client and project, their selects are hidden: a
 *  refusal about either is said above the form instead. */
const LOCKED_FIELDS = ['title'] as const;

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
  const te = useTranslations('errors');
  const locked = Boolean(lock.clientId && lock.projectId);
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({
    fields: locked ? LOCKED_FIELDS : ENGAGEMENT_CREATE_FIELDS,
    translate: te,
  });
  const { clear } = errors;
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
    clear();
    setTitleTyped(false);
    setValues({
      ...EMPTY_VALUES,
      ...(locked ? titlesOf({ nameEn: lockedNameEn, nameAr: lockedNameAr }) : {}),
      clientId: lock.clientId ?? '',
      projectId: lock.projectId ?? '',
    });
  }, [open, locked, lock.clientId, lock.projectId, lockedNameEn, lockedNameAr, clear]);

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
    if (errors.applyLocal(engagementCreateFieldErrors(values))) return;
    startTransition(async () => {
      try {
        const res = await createEngagement({
          titleEn: values.titleEn || null,
          titleAr: values.titleAr || null,
          clientId: values.clientId,
          projectId: values.projectId,
          offPlan: values.offPlan,
        });
        if (errors.applyResult(res)) return;
        invariant(res.data, 'createEngagement answered ok without an id');
        onCreated();
        router.push(`/engagements/${res.data}`);
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return { values, onChange, projectsForClient, errors, pending, submit, locked };
}
