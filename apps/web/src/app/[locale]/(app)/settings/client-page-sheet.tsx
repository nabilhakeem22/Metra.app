'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import { FormField } from '@/components/ui/form-field';
import { FormSheet } from '@/components/ui/form-sheet';
import { Input } from '@/components/ui/input';
import { SectionLabel } from '@/components/ui/section-label';
import { useFieldErrors } from '@/hooks/use-field-errors';
import { toast } from '@/hooks/use-toast';
import { useRouter } from '@/i18n/routing';
import { updateClientPageDetails } from '@/lib/org/client-page-actions';
import { CLIENT_PAGE_FIELDS, type ClientPageField } from '@/lib/org/client-page-details';
import { CLIENT_PAGE_FIELD_SPECS, changedDraftFields, type ClientPageDraft } from './client-page-fields';

/** The control a client-page field's refusal sits under. */
export function clientPageControlId(field: ClientPageField): string {
  return `client-page-${field}`;
}

/**
 * Edit what the client page shows about the studio, in the app's form sheet.
 * Every refusal is said under the field it names, all at once (no toast); one
 * that names no field is said above the footer. Owner/admin only: the card opens it only
 * for them, and the server action re-checks.
 */
export function ClientPageSheet({
  open,
  onOpenChange,
  initial,
  revision,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ClientPageDraft;
  /** The stored values' revision the sheet saves against (a stale save is refused). */
  revision: string;
}) {
  const t = useTranslations('settings.clientPage');
  const te = useTranslations('errors');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(initial);
  const errors = useFieldErrors({ fields: CLIENT_PAGE_FIELDS, translate: te });
  const { clear } = errors;

  useEffect(() => {
    if (!open) return;
    setDraft(initial);
    clear();
  }, [open, initial, clear]);

  // No client pre-check: the phone, IBAN and printable-text rules are the
  // server's own (studio-phone.ts, printable-text.ts), and it names every
  // refused field at once.
  function submit() {
    clear();
    startTransition(async () => {
      try {
        const result = await updateClientPageDetails({ revision, changes: changedDraftFields(initial, draft) });
        if (errors.applyResult(result)) return;
        toast({ title: t('saved') });
        onOpenChange(false);
        router.refresh();
      } catch (rejection) {
        errors.applyRejection(rejection);
      }
    });
  }

  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('title')}
      description={t('subtitle')}
      onSubmit={submit}
      submitLabel={t('save')}
      cancelLabel={tc('cancel')}
      closeLabel={tc('close')}
      pending={pending}
      formError={errors.formError}
      invalidAttempt={errors.invalidAttempt}
    >
      <p className="text-caption text-muted-foreground">{t('alertNote')}</p>
      {(['contact', 'payment'] as const).map((group) => (
        <div key={group} className="space-y-4">
          <SectionLabel as="h3">{t(group === 'contact' ? 'contactHeading' : 'paymentHeading')}</SectionLabel>
          {CLIENT_PAGE_FIELD_SPECS.filter((spec) => spec.group === group).map((spec) => (
            <FormField
              key={spec.field}
              id={clientPageControlId(spec.field)}
              label={t(`fields.${spec.field}`)}
              {...errors.bind(spec.field)}
            >
              <Input
                dir={spec.ltr ? 'ltr' : 'auto'}
                inputMode={spec.inputMode}
                autoComplete={spec.autoComplete ?? 'off'}
                value={draft[spec.field]}
                onChange={(event) => setDraft({ ...draft, [spec.field]: event.target.value })}
              />
            </FormField>
          ))}
        </div>
      ))}
    </FormSheet>
  );
}
