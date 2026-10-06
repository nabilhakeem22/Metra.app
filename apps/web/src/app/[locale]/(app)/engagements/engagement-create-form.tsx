'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { resolveActionError } from '@/lib/actions/error-message';
import type { ClientOption } from '@/lib/clients/queries';
import { NeedFirst } from './delivery-form-parts';
import { EngagementCreateFields } from './engagement-create-fields';
import {
  canSubmitDelivery,
  type DeliveryFormField,
  type ProjectNames,
  type ProjectOption,
} from './engagement-create-validation';
import { useDeliveryForm } from './use-delivery-form';

export type { ProjectOption } from './engagement-create-validation';

/**
 * "Start delivery". Client and project are required and marked, Submit waits
 * for both, a refusal shows under its field, and a missing client or project is
 * an empty state with the button that adds it (for a role that may).
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
  const te = useTranslations('errors');
  const tStart = useTranslations('engagements');
  const form = useDeliveryForm({
    open,
    projectOptions,
    lock: { clientId: lockedClientId, projectId: lockedProjectId, projectName: lockedProjectName },
    onCreated: () => onOpenChange(false),
  });

  const messageFor = (field: DeliveryFormField) =>
    form.error?.field === field ? resolveActionError(form.error.code, te) : undefined;
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
      <div className="mt-4 space-y-4">
        {messageFor('form') && (
          <p className="text-body text-destructive" role="alert">
            {messageFor('form')}
          </p>
        )}
        <EngagementCreateFields
          values={form.values}
          onChange={form.onChange}
          locked={form.locked}
          clientOptions={clientOptions}
          projectsForClient={form.projectsForClient}
          fieldErrors={{
            title: messageFor('title'),
            client: messageFor('client'),
            project: messageFor('project'),
          }}
          projectHint={
            form.values.clientId !== '' && form.projectsForClient.length === 0
              ? needProject
              : undefined
          }
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={form.pending}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="default"
            type="button"
            onClick={form.submit}
            disabled={form.pending || !canSubmitDelivery(form.values)}
          >
            {form.pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {tStart('startDelivery')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetTitle>{tStart('startDelivery')}</SheetTitle>
        <SheetDescription className="sr-only">{tStart('startDelivery')}</SheetDescription>
        {body}
      </SheetContent>
    </Sheet>
  );
}
