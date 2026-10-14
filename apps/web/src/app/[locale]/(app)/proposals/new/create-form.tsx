'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState, useTransition } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { createProposal } from '@/lib/proposals/actions';
import {
  PROPOSAL_CREATE_FIELDS,
  proposalCreateFieldErrors,
} from '@/lib/proposals/create-fields';
import { CreateFormActions } from './create-form-actions';
import { ProposalCreateFields, type CreateTyped, type Option } from './create-form-fields';

/**
 * "New proposal": a client and a project (required), optional titles and
 * dates. Submit says under each field what is missing or wrong, before and
 * after the server is asked; anything else is said above the buttons.
 */
export function ProposalCreateForm({
  clients,
  projects,
  defaultProjectId,
}: {
  clients: Option[];
  projects: Option[];
  /** Preselect this project (e.g. arriving from a project profile). */
  defaultProjectId?: string;
}) {
  const t = useTranslations('proposals');
  const te = useTranslations('errors');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const errors = useFieldErrors({ fields: PROPOSAL_CREATE_FIELDS, translate: te });
  const formRef = useRef<HTMLDivElement>(null);
  useFocusFirstInvalid(formRef, errors.invalidAttempt);

  // Arriving from a project's "new proposal" CTA: preselect that project (and
  // its client), else fall back to the first option.
  const preselected = defaultProjectId ? projects.find((p) => p.id === defaultProjectId) : undefined;
  const [typed, setTyped] = useState<CreateTyped>({
    clientId: preselected?.clientId ?? clients[0]?.id ?? '',
    projectId: preselected?.id ?? projects[0]?.id ?? '',
    titleEn: '',
    titleAr: '',
    issueDate: '',
    expiryDate: '',
  });
  const set = (key: keyof CreateTyped) => (value: string) =>
    setTyped((current) => ({ ...current, [key]: value }));

  function submit() {
    const input = {
      clientId: typed.clientId,
      projectId: typed.projectId,
      titleEn: typed.titleEn || null,
      titleAr: typed.titleAr || null,
      issueDate: typed.issueDate || null,
      expiryDate: typed.expiryDate || null,
    };
    if (errors.applyLocal(proposalCreateFieldErrors(input))) return;
    startTransition(async () => {
      try {
        const res = await createProposal(input);
        if (errors.applyResult(res)) return;
        toast({ title: t('toast.created') });
        router.push(`/proposals/${res.data}`);
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        {clients.length === 0 || projects.length === 0 ? (
          <p className="text-body text-muted-foreground">{t('create.needFirst')}</p>
        ) : (
          <div ref={formRef} className="space-y-4">
            <ProposalCreateFields
              typed={typed}
              set={set}
              clients={clients}
              projects={projects}
              bind={errors.bind}
            />
            <CreateFormActions
              formError={errors.formError}
              pending={pending}
              onCancel={() => router.push('/proposals')}
              onSubmit={submit}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
