import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs rule module has no types
import rule from '../../../../eslint-rules/design-tokens-only.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as never,
    parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
  },
});

const APP_FILE = 'apps/web/src/app/[locale]/(app)/clients/page.tsx';
const DASHBOARD_FILE = 'apps/web/src/components/dashboard/dashboard-view.tsx';

it('design-tokens-only: tokens pass, everything off the scale fails', () => {
  ruleTester.run('design-tokens-only', rule as never, {
    valid: [
      { code: 'const a = <p className="text-caption sm:text-body rounded-item" />;', filename: APP_FILE },
      { code: "const m = { open: 'rounded-panel text-heading font-bold' };", filename: APP_FILE },
      { code: 'const a = <p className="rounded-e-panel rounded-full rounded-none text-[color:var(--text)]" />;', filename: APP_FILE },
      { code: 'const a = <p className="text-display font-bold" />;', filename: DASHBOARD_FILE },
      { code: 'const a = <p style={{ padding: 4, color: "red" }} />;', filename: APP_FILE },
      { code: '// text-sm rounded-md in a comment is prose\nconst a = 1;', filename: APP_FILE },
      { code: 'const a = <p className="bg-brand-tint text-[color:var(--warn)]" />;', filename: APP_FILE },
      // Latin-only typography, scoped to Latin: an ltr: variant, a dir="ltr"
      // element, or (mono / tracking) figures.
      { code: 'const a = <p className="ltr:uppercase ltr:font-mono ltr:tracking-[0.08em]" />;', filename: APP_FILE },
      { code: 'const a = <code dir="ltr" className="font-mono uppercase tracking-wide" />;', filename: APP_FILE },
      { code: 'const a = <span dir="ltr" className={cn("font-mono", x)} />;', filename: APP_FILE },
      { code: "const m = { figure: 'font-mono tabular-nums tracking-tight' };", filename: APP_FILE },
      { code: "const m = { num: 'tracking-[var(--tracking-num)]' };", filename: APP_FILE },
    ],
    invalid: [
      { code: 'const a = <p className="text-[11px]" />;', filename: APP_FILE, errors: [{ messageId: 'offScaleType' }] },
      { code: "const m = { chip: 'text-xs' };", filename: APP_FILE, errors: [{ messageId: 'offScaleType' }] },
      { code: 'const a = `md:text-2xl ${x}`;', filename: APP_FILE, errors: [{ messageId: 'offScaleType' }] },
      { code: 'const a = <p className="text-display" />;', filename: APP_FILE, errors: [{ messageId: 'displayOutsideDashboard' }] },
      { code: 'const a = <p className="rounded" />;', filename: APP_FILE, errors: [{ messageId: 'offScaleRadius' }] },
      { code: "const c = cn('rounded-[8px]');", filename: APP_FILE, errors: [{ messageId: 'offScaleRadius' }] },
      { code: 'const a = <p className="rounded-t-xl" />;', filename: APP_FILE, errors: [{ messageId: 'offScaleRadius' }] },
      { code: 'const a = <p className="hover:bg-amber-50/50" />;', filename: APP_FILE, errors: [{ messageId: 'paletteColour' }] },
      { code: 'const a = <p className="font-extrabold" />;', filename: APP_FILE, errors: [{ messageId: 'offSetWeight' }] },
      { code: 'const a = <p style={{ fontSize: 12 }} />;', filename: APP_FILE, errors: [{ messageId: 'styleKey' }] },
      { code: "const a = <p style={{ borderRadius: '8px' }} />;", filename: APP_FILE, errors: [{ messageId: 'styleKey' }] },
      { code: 'const a = <p className="uppercase" />;', filename: APP_FILE, errors: [{ messageId: 'arabicUnsafe' }] },
      { code: 'const a = <p className="font-mono" />;', filename: APP_FILE, errors: [{ messageId: 'arabicUnsafe' }] },
      { code: "const m = { label: 'tracking-[0.1em]' };", filename: APP_FILE, errors: [{ messageId: 'arabicUnsafe' }] },
      // `tabular` excuses figures from mono and tracking, never from uppercase.
      { code: "const m = { label: 'uppercase tabular' };", filename: APP_FILE, errors: [{ messageId: 'arabicUnsafe' }] },
      { code: 'const a = <p dir="rtl" className="font-mono" />;', filename: APP_FILE, errors: [{ messageId: 'arabicUnsafe' }] },
    ],
  });
});
