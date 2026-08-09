import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs rule module has no types
import rule from '../../../../eslint-rules/no-physical-inline-direction.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as never,
    parserOptions: {
      ecmaFeatures: { jsx: true },
      sourceType: 'module',
    },
  },
});

it('no-physical-inline-direction: fails on physical, passes on logical', () => {
  ruleTester.run('no-physical-inline-direction', rule as never, {
    valid: [
      { code: 'const a = <div className="ms-4 text-start" />;' },
      { code: "const s = { marginInlineStart: 4, textAlign: 'start' };" },
      { code: "const c = cn('ps-2', 'me-1');" },
      { code: 'const a = <div className="flex items-center gap-2" />;' },
    ],
    invalid: [
      {
        code: 'const a = <div className="ml-4" />;',
        errors: [{ messageId: 'twClass' }],
      },
      {
        code: 'const a = <div className="text-left" />;',
        errors: [{ messageId: 'twClass' }],
      },
      {
        code: 'const s = { marginLeft: 4 };',
        errors: [{ messageId: 'styleKey' }],
      },
      {
        code: "const s = { textAlign: 'left' };",
        errors: [{ messageId: 'textAlign' }],
      },
      { code: "const c = cn('mr-2');", errors: [{ messageId: 'twClass' }] },
    ],
  });
});
