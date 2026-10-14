'use client';

import { useTranslations } from 'next-intl';
import { FormSheet } from '@/components/ui/form-sheet';
import type { ClientOption } from '@/lib/clients/queries';
import { NeedFirst } from './delivery-form-parts';
import { EngagementCreateFields } from './engagement-create-fields';
import type { ProjectNames, ProjectOption } from './delivery-options';
import { useDeliveryForm } from './use-delivery-form';

export type { ProjectOption } from './delivery-options';

/**
 * "Start delivery". Client and project are required and marked; Save says
 * under each one what is missing, a server refusal shows under its field, and
 * a missing client or project is an empty state with the button that adds it
 * (for a role that may).
 */
export function EngagementCreateForm({
  open,
  onOpenChange,
  clientOptions,
  projectOptions,
  lockedClientId,
  lockedProjectId,
  lockedProjectName,
  setupLinks,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientOptions: ClientOption[];
  projectOptions: ProjectOption[];
  /**
   * When BOTH locked ids are set (the through-project "Start delivery" entry), the
   * client + project selects are hidden and these ids are forced — the caller need
   * not pass `clientOptions`/`projectOptions` in that mode.
   */
  lockedClientId?: string;
  lockedProjectId?: string;
  /** The locked project's names, so the title can be prefilled from them. */
  lockedProjectName?: ProjectNames;
  /** May this role add the missing client / project (the empty-state buttons)? */
  setupLinks?: { canAddClient: boolean; canAddProject: boolean };
}) {
  const t = useTranslations('engagements.form');
  const tStart = useTranslations('engagements');
  const tc = useTranslations('common');
  const form = useDeliveryForm({
    open,
    projectOptions,
    lock: { clientId: lockedClientId, projectId: lockedProjectId, projectName: lockedProjectName },
    onCreated: () => onOpenChange(false),
  });

  const needProject = (
    <NeedFirst
      message={t('needProject')}
      href={setupLinks?.canAddProject ? '/projects?new=1' : undefined}
      cta={t('addProject')}
    />
  );

  let body;
  if (!form.locked && clientOptions.length === 0) {
    body = (
      <NeedFirst
        message={t('needClient')}
        href={setupLinks?.canAddClient ? '/clients?new=1' : undefined}
        cta={t('addClient')}
      />
    );
  } else if (!form.locked && projectOptions.length === 0) {
    body = needProject;
  } else {
    body = (
      <EngagementCreateFields
        values={form.values}
        onChange={form.onChange}
        locked={form.locked}
        clientOptions={clientOptions}
        projectsForClient={form.projectsForClient}
        bind={form.errors.bind}
        projectHint={
          form.values.clientId !== '' && form.projectsForClient.length === 0
            ? needProject
            : undefined
        }
      />
    );
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={tStart('startDelivery')}
      onSubmit={form.submit}
      submitLabel={tStart('startDelivery')}
      cancelLabel={t('cancel')}
      closeLabel={tc('close')}
      pending={form.pending}
      formError={form.errors.formError}
      invalidAttempt={form.errors.invalidAttempt}
    >
      {body}
    </FormSheet>
  );
}
