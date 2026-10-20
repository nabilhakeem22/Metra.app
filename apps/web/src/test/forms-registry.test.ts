import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { destructiveToasts } from '@/test/destructive-toasts';
import { loadSourceGraph, SRC_ROOT, srcRelative } from '@/test/source-graph';

// Every form that shows refusals under its fields is REGISTERED here, so a new
// form cannot quietly skip the under-the-field contract.
//
// FORM_COVERAGE: a file that renders <FormField> or <FieldErrorText>, or uses
// useFieldErrors / useDraftFieldErrors, and the test file that runs
// `expectFieldErrorsRenderUnderFields` for it (AC 19: every field of its tuple,
// answered `required`, shows its sentence under its own control, focus on the
// first, no alert, typed values kept). The test must LOAD the form (its imports
// reach the file), so a call made for another form proves nothing about this
// one. Every form is migrated, so there is no pending list.
//
// CLIENT_ONLY_COVERAGE: a field whose refusal only the page itself says (the
// server answers it no field errors, so the helper's mocked answer does not
// apply), and the test that loads it and checks the refusal under its box.

/** Form file (from src) to the test that proves its fields' refusals render under them. */
const FORM_COVERAGE: Readonly<Record<string, string>> = {
  'app/[locale]/(app)/clients/[id]/contact-form.tsx': 'app/[locale]/(app)/clients/[id]/contact-form.test.tsx',
  'app/[locale]/(app)/clients/[id]/details-tab.tsx': 'app/[locale]/(app)/clients/[id]/details-tab.test.tsx',
  'app/[locale]/(app)/clients/[id]/use-client-details-form.ts': 'app/[locale]/(app)/clients/[id]/details-tab.test.tsx',
  'app/[locale]/(app)/clients/client-form-fields.tsx': 'app/[locale]/(app)/clients/client-form.test.tsx',
  'app/[locale]/(app)/clients/client-form.tsx': 'app/[locale]/(app)/clients/client-form.test.tsx',
  'app/[locale]/(app)/contracts/[id]/baseline-line-picker.tsx': 'app/[locale]/(app)/contracts/[id]/contract-forms.test.tsx',
  'app/[locale]/(app)/contracts/[id]/contract-header-form.tsx': 'app/[locale]/(app)/contracts/[id]/contract-forms.test.tsx',
  'app/[locale]/(app)/contracts/[id]/cost-entry-form.tsx': 'app/[locale]/(app)/contracts/[id]/cost-entry-form.test.tsx',
  'app/[locale]/(app)/contracts/[id]/cost-entry-item-field.tsx': 'app/[locale]/(app)/contracts/[id]/cost-entry-form.test.tsx',
  'app/[locale]/(app)/contracts/[id]/cost-entry-target-fields.tsx': 'app/[locale]/(app)/contracts/[id]/cost-entry-form.test.tsx',
  'app/[locale]/(app)/contracts/[id]/use-cost-entry-form.ts': 'app/[locale]/(app)/contracts/[id]/cost-entry-form.test.tsx',
  'app/[locale]/(app)/contracts/[id]/use-variation-create.ts': 'app/[locale]/(app)/contracts/[id]/contract-forms.test.tsx',
  'app/[locale]/(app)/contracts/[id]/variation-create-form.tsx': 'app/[locale]/(app)/contracts/[id]/contract-forms.test.tsx',
  'app/[locale]/(app)/contracts/[id]/variation-line-row.tsx': 'app/[locale]/(app)/contracts/[id]/contract-forms.test.tsx',
  'app/[locale]/(app)/engagements/[id]/acknowledgement-form.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/[id]/client-expected-date.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/[id]/command-card-claim-row.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/[id]/document-thread-panel.tsx': 'app/[locale]/(app)/engagements/[id]/document-thread-panel.test.tsx',
  'app/[locale]/(app)/engagements/[id]/engagement-fee-form.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/[id]/engagement-payment-form.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/[id]/engagement-payment-panel.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/[id]/engagement-retract-button.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/[id]/engagement-revision-form.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/[id]/engagement-rom-range-form.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/[id]/offline-approval-fields.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/[id]/offline-approval-form.tsx': 'app/[locale]/(app)/engagements/[id]/cockpit-forms-under-fields.test.tsx',
  'app/[locale]/(app)/engagements/engagement-create-fields.tsx': 'app/[locale]/(app)/engagements/engagement-create-form.test.tsx',
  'app/[locale]/(app)/engagements/use-delivery-form.ts': 'app/[locale]/(app)/engagements/engagement-create-form.test.tsx',
  'app/[locale]/(app)/market-book/market-add-form.tsx': 'app/[locale]/(app)/market-book/market-add-form.test.tsx',
  'app/[locale]/(app)/price-book/bulk-update-dialog.tsx': 'app/[locale]/(app)/price-book/price-book-forms.test.tsx',
  'app/[locale]/(app)/price-book/cost-item-form-fields.tsx': 'app/[locale]/(app)/price-book/cost-item-form.test.tsx',
  'app/[locale]/(app)/price-book/cost-item-form.tsx': 'app/[locale]/(app)/price-book/cost-item-form.test.tsx',
  'app/[locale]/(app)/price-book/import-wizard-map-step.tsx': 'app/[locale]/(app)/price-book/price-book-forms.test.tsx',
  'app/[locale]/(app)/price-book/use-import-wizard.ts': 'app/[locale]/(app)/price-book/price-book-forms.test.tsx',
  'app/[locale]/(app)/price-book/use-section-adder.ts': 'app/[locale]/(app)/price-book/price-book-forms.test.tsx',
  'app/[locale]/(app)/projects/[id]/boq-start.tsx': 'app/[locale]/(app)/projects/[id]/boq-start.test.tsx',
  'app/[locale]/(app)/projects/[id]/details-fields.tsx': 'app/[locale]/(app)/projects/[id]/details-tab.test.tsx',
  'app/[locale]/(app)/projects/[id]/details-type-field.tsx': 'app/[locale]/(app)/projects/[id]/details-tab.test.tsx',
  'app/[locale]/(app)/projects/[id]/use-add-project-type.ts': 'app/[locale]/(app)/projects/[id]/details-tab.test.tsx',
  'app/[locale]/(app)/projects/[id]/use-project-details-form.ts': 'app/[locale]/(app)/projects/[id]/details-tab.test.tsx',
  'app/[locale]/(app)/projects/project-form-fields.tsx': 'app/[locale]/(app)/projects/project-form.test.tsx',
  'app/[locale]/(app)/projects/project-form-schedule.tsx': 'app/[locale]/(app)/projects/project-form.test.tsx',
  'app/[locale]/(app)/projects/project-form.tsx': 'app/[locale]/(app)/projects/project-form.test.tsx',
  'app/[locale]/(app)/proposals/new/create-form-fields.tsx': 'app/[locale]/(app)/proposals/new/create-form.test.tsx',
  'app/[locale]/(app)/proposals/new/create-form.tsx': 'app/[locale]/(app)/proposals/new/create-form.test.tsx',
  'app/[locale]/(app)/settings/account/account-client.tsx': 'app/[locale]/(app)/settings/account/account-client.test.tsx',
  'app/[locale]/(app)/settings/api-keys/api-keys-create-card.tsx': 'app/[locale]/(app)/settings/api-keys/api-keys-client.test.tsx',
  'app/[locale]/(app)/settings/api-keys/use-api-key-create.ts': 'app/[locale]/(app)/settings/api-keys/api-keys-client.test.tsx',
  'app/[locale]/(app)/settings/automation-settings-client.tsx': 'app/[locale]/(app)/settings/automation-settings-client.test.tsx',
  'app/[locale]/(app)/settings/client-page-sheet.tsx': 'app/[locale]/(app)/settings/client-page-sheet.test.tsx',
  'app/[locale]/(app)/settings/document-category-add-form.tsx': 'app/[locale]/(app)/settings/document-category-add-form.test.tsx',
  'app/[locale]/(app)/settings/settings-client.tsx': 'app/[locale]/(app)/settings/settings-client.test.tsx',
  'app/[locale]/(app)/settings/settings-profile-card.tsx': 'app/[locale]/(app)/settings/settings-client.test.tsx',
  'app/[locale]/(app)/settings/use-automation-form.ts': 'app/[locale]/(app)/settings/automation-settings-client.test.tsx',
  'app/[locale]/(app)/team/team-invite-form.tsx': 'app/[locale]/(app)/team/team-client.test.tsx',
  'app/[locale]/(app)/team/use-invite-form.ts': 'app/[locale]/(app)/team/team-client.test.tsx',
  'app/[locale]/d/[token]/portal/use-changes-note.ts': 'app/[locale]/d/[token]/portal/concept-option-picker-changes.test.tsx',
  'app/[locale]/d/[token]/portal/use-comment-refusals.ts': 'app/[locale]/d/[token]/portal/document-thread.test.tsx',
  'app/[locale]/(auth)/login/login-request-step.tsx': 'app/[locale]/(auth)/login/login-form.test.tsx',
  'app/[locale]/(auth)/login/use-otp-flow.ts': 'app/[locale]/(auth)/login/login-form.test.tsx',
  'app/[locale]/onboarding/onboarding-profile-fields.tsx': 'app/[locale]/onboarding/wizard.test.tsx',
  'app/[locale]/onboarding/wizard.tsx': 'app/[locale]/onboarding/wizard.test.tsx',
  'components/activity/activity-note-form.tsx': 'components/activity/activity-note-form.test.tsx',
  'components/documents/document-upload-control.tsx': 'components/documents/document-upload-control.test.tsx',
  'app/[locale]/(app)/price-book/import-wizard-upload-step.tsx': 'app/[locale]/(app)/price-book/price-book-forms.test.tsx',
  'app/[locale]/(app)/price-book/price-book-section-adder.tsx': 'app/[locale]/(app)/price-book/price-book-forms.test.tsx',
  'app/[locale]/(app)/projects/[id]/boq-sheet-editable-cell.tsx': 'app/[locale]/(app)/projects/[id]/boq-sheet.test.tsx',
  'app/[locale]/(app)/projects/[id]/boq-sheet-unit-cell.tsx': 'app/[locale]/(app)/projects/[id]/boq-sheet.test.tsx',
  'app/[locale]/(app)/proposals/[id]/draft-cell.tsx': 'app/[locale]/(app)/proposals/[id]/builder-cell-refusals.test.tsx',
  'app/[locale]/(app)/proposals/[id]/use-builder-autosave.ts': 'app/[locale]/(app)/proposals/[id]/builder-cell-refusals.test.tsx',
  'app/[locale]/(app)/proposals/[id]/use-draft-field-errors.ts': 'app/[locale]/(app)/proposals/[id]/builder-cell-refusals.test.tsx',
  'app/[locale]/(app)/settings/settings-logo-field.tsx': 'app/[locale]/(app)/settings/settings-client.test.tsx',
  'app/[locale]/(auth)/login/login-verify-step.tsx': 'app/[locale]/(auth)/login/login-form.test.tsx',
  'app/[locale]/d/[token]/portal/changes-note.tsx': 'app/[locale]/d/[token]/portal/concept-option-picker-changes.test.tsx',
  'app/[locale]/d/[token]/portal/document-thread.tsx': 'app/[locale]/d/[token]/portal/document-thread.test.tsx',
};

/** Client-only refusals (the /p /c /v name box) to the test that says them under the box. */
const CLIENT_ONLY_COVERAGE: Readonly<Record<string, string>> = {
  'components/share/link-name-field.tsx': 'components/share/link-page-failures.test.tsx',
};

const REGISTERED: Readonly<Record<string, string>> = { ...FORM_COVERAGE, ...CLIENT_ONLY_COVERAGE };

const graph = loadSourceGraph();
const textOf = (path: string) => graph.files.get(path)!.getFullText();

const USES_FIELD_ERRORS = /\buse(?:Draft)?FieldErrors\b/;
const RENDERS_FIELD_ERRORS = /<(?:FormField|FieldErrorText)\b/;
const HELPER_CALL = /\bexpectFieldErrorsRenderUnderFields\(/;
/** A client-only proof reads the refusal under the box by its `<id>-error`. */
const UNDER_THE_BOX = /-error`/;
/** The building blocks themselves, not forms. */
const BLOCKS = /[\\/](components[\\/]ui[\\/](form-field|field-error-text)|hooks[\\/]use-field-errors)\.tsx?$/;

const formFiles = [...graph.files.keys()]
  .filter((path) => !BLOCKS.test(path))
  .filter((path) => RENDERS_FIELD_ERRORS.test(textOf(path)) || USES_FIELD_ERRORS.test(textOf(path)))
  .map(srcRelative)
  .sort();

/** True when loading `testFile` loads `file`, through any chain of imports. */
function loads(testFile: string, file: string): boolean {
  const target = join(SRC_ROOT, file);
  const seen = new Set<string>();
  const pending = [join(SRC_ROOT, testFile)];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (path === target) return true;
    if (seen.has(path)) continue;
    seen.add(path);
    pending.push(...graph.importsOf(path));
  }
  return false;
}

describe('every form is registered (AC 20)', () => {
  it('finds the forms it is meant to guard', () => {
    expect(formFiles.length).toBeGreaterThan(0);
  });

  it.each(formFiles)('%s is covered', (file) => {
    expect(
      file in REGISTERED,
      `${file} renders field errors: add it to FORM_COVERAGE with the test that runs expectFieldErrorsRenderUnderFields`,
    ).toBe(true);
  });

  it('lists no file that is gone', () => {
    for (const file of Object.keys(REGISTERED)) {
      expect(formFiles, `${file} is registered but renders no field`).toContain(file);
    }
  });

  it.each(Object.entries(REGISTERED))('%s is proven by %s', (file, testFile) => {
    const path = join(SRC_ROOT, testFile);
    expect(existsSync(path), `${testFile} does not exist`).toBe(true);
    expect(loads(testFile, file), `${testFile} never loads ${file}`).toBe(true);
    expect(readFileSync(path, 'utf8')).toMatch(file in FORM_COVERAGE ? HELPER_CALL : UNDER_THE_BOX);
  });
});

describe('a form with field errors raises no failure toast (AC 21)', () => {
  it('no file that uses useFieldErrors shows a destructive toast', () => {
    const hookUsers = formFiles.filter((file) => USES_FIELD_ERRORS.test(textOf(join(SRC_ROOT, file))));
    for (const file of hookUsers) {
      expect(destructiveToasts(graph.files.get(join(SRC_ROOT, file))!), `${file}: say the refusal under the field`).toBe(0);
    }
  });
});
