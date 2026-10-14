import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { loadSourceGraph, SRC_ROOT, srcRelative } from '@/test/source-graph';

// Every form that shows refusals under its fields is REGISTERED here, so a new
// form cannot quietly skip the under-the-field contract.
//
// FORM_COVERAGE: a file that renders <FormField> or uses useFieldErrors, and the
// test file that runs `expectFieldErrorsRenderUnderFields` for it (AC 19: every
// field of its tuple, answered `required`, shows its sentence under its own
// control, focus on the first, no alert, typed values kept).
// PENDING_FORMS: the ones not migrated yet. It only shrinks, and the last W2
// migration deletes it.

/** Form file (from src) to the test that proves its fields' refusals render under them. */
const FORM_COVERAGE: Readonly<Record<string, string>> = {
  'app/[locale]/(app)/clients/[id]/contact-form.tsx': 'app/[locale]/(app)/clients/[id]/contact-form.test.tsx',
  'app/[locale]/(app)/clients/client-form-fields.tsx': 'app/[locale]/(app)/clients/client-form.test.tsx',
  'app/[locale]/(app)/clients/client-form.tsx': 'app/[locale]/(app)/clients/client-form.test.tsx',
  'app/[locale]/(app)/engagements/engagement-create-fields.tsx': 'app/[locale]/(app)/engagements/engagement-create-form.test.tsx',
  'app/[locale]/(app)/engagements/use-delivery-form.ts': 'app/[locale]/(app)/engagements/engagement-create-form.test.tsx',
  'app/[locale]/(app)/price-book/cost-item-form-fields.tsx': 'app/[locale]/(app)/price-book/cost-item-form.test.tsx',
  'app/[locale]/(app)/price-book/cost-item-form.tsx': 'app/[locale]/(app)/price-book/cost-item-form.test.tsx',
  'app/[locale]/(app)/projects/project-form-fields.tsx': 'app/[locale]/(app)/projects/project-form.test.tsx',
  'app/[locale]/(app)/projects/project-form-schedule.tsx': 'app/[locale]/(app)/projects/project-form.test.tsx',
  'app/[locale]/(app)/projects/project-form.tsx': 'app/[locale]/(app)/projects/project-form.test.tsx',
  'app/[locale]/(app)/settings/account/account-client.tsx': 'app/[locale]/(app)/settings/account/account-client.test.tsx',
  'app/[locale]/(app)/settings/client-page-sheet.tsx': 'app/[locale]/(app)/settings/client-page-sheet.test.tsx',
  'app/[locale]/(app)/settings/settings-client.tsx': 'app/[locale]/(app)/settings/settings-client.test.tsx',
  'app/[locale]/(app)/settings/settings-profile-card.tsx': 'app/[locale]/(app)/settings/settings-client.test.tsx',
  'app/[locale]/onboarding/onboarding-profile-fields.tsx': 'app/[locale]/onboarding/wizard.test.tsx',
  'app/[locale]/onboarding/wizard.tsx': 'app/[locale]/onboarding/wizard.test.tsx',
};

/** Forms still on the old one-error-at-a-time shape. Only ever shrinks. */
const PENDING_FORMS: readonly string[] = [
  // Sign-in (W1.7): its refusals are under the boxes, but login-form.test.tsx
  // does not run expectFieldErrorsRenderUnderFields yet.
  'app/[locale]/(auth)/login/login-request-step.tsx',
  'app/[locale]/(auth)/login/use-otp-flow.ts',
];

const graph = loadSourceGraph();
const textOf = (path: string) => graph.files.get(path)!.getFullText();

const USES_FIELD_ERRORS = /\buseFieldErrors\b/;
const RENDERS_FORM_FIELD = /<FormField\b/;
const DESTRUCTIVE_TOAST = /variant:\s*'destructive'/;

const formFiles = [...graph.files.keys()]
  .filter((path) => !/[\\/](components[\\/]ui[\\/]form-field|hooks[\\/]use-field-errors)\.tsx?$/.test(path))
  .filter((path) => RENDERS_FORM_FIELD.test(textOf(path)) || USES_FIELD_ERRORS.test(textOf(path)))
  .map(srcRelative)
  .sort();

describe('every form is registered (AC 20)', () => {
  it('finds the forms it is meant to guard', () => {
    expect(formFiles.length).toBeGreaterThan(0);
  });

  it.each(formFiles)('%s is covered or pending', (file) => {
    expect(
      file in FORM_COVERAGE || PENDING_FORMS.includes(file),
      `${file} renders <FormField> or uses useFieldErrors: add it to FORM_COVERAGE with the test that runs expectFieldErrorsRenderUnderFields`,
    ).toBe(true);
  });

  it('lists no form twice and no file that is gone', () => {
    for (const file of PENDING_FORMS) expect(file in FORM_COVERAGE, `${file} is in both lists`).toBe(false);
    for (const file of [...Object.keys(FORM_COVERAGE), ...PENDING_FORMS]) {
      expect(formFiles, `${file} is registered but renders no field`).toContain(file);
    }
  });

  it.each(Object.entries(FORM_COVERAGE))('%s is proven by %s', (_file, testFile) => {
    const path = join(SRC_ROOT, testFile);
    expect(existsSync(path), `${testFile} does not exist`).toBe(true);
    expect(readFileSync(path, 'utf8')).toMatch(/expectFieldErrorsRenderUnderFields\(/);
  });
});

describe('a form with field errors raises no failure toast (AC 21)', () => {
  it('no file that uses useFieldErrors shows a destructive toast', () => {
    const hookUsers = formFiles.filter((file) => USES_FIELD_ERRORS.test(textOf(join(SRC_ROOT, file))));
    for (const file of hookUsers) {
      expect(textOf(join(SRC_ROOT, file)), `${file}: say the refusal under the field`).not.toMatch(DESTRUCTIVE_TOAST);
    }
  });
});

/** The value imports of one module that only a server may load. */
function serverOnlyImports(path: string): string[] {
  return graph.files.get(path)!.statements.flatMap((statement) => {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
    if (statement.importClause?.isTypeOnly) return [];
    const specifier = statement.moduleSpecifier.text;
    return specifier === 'server-only' || specifier === '@metra/db' ? [specifier] : [];
  });
}

describe('no client component reaches server-only code (AC 36)', () => {
  const clientModules = [...graph.files.keys()].filter((path) => graph.directiveOf(path) === 'use client');

  it.each(clientModules.map(srcRelative))('%s', (file) => {
    const seen = new Set<string>();
    const pending = [join(SRC_ROOT, file)];
    const reached: string[] = [];
    while (pending.length > 0) {
      const path = pending.pop()!;
      if (seen.has(path)) continue;
      seen.add(path);
      // A server action module is an RPC reference in the client bundle, not its code.
      if (graph.directiveOf(path) === 'use server') continue;
      const relative = srcRelative(path);
      if (relative === 'lib/actions/unexpected.ts') reached.push(relative);
      for (const specifier of serverOnlyImports(path)) reached.push(`${relative} imports ${specifier}`);
      pending.push(...graph.importsOf(path));
    }
    expect(reached).toEqual([]);
  });
});
