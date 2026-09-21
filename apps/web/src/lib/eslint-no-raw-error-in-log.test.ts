import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs rule module has no types
import {
  CAUGHT_VALUE_NAMES,
  noRawErrorInLog,
} from '../../../../eslint-rules/no-raw-error-in-log.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as never,
    parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
  },
});

/**
 * The rule that keeps the redactor in place. The `valid` block is the real
 * shape of every sink this wave rewrote — so if somebody "simplifies" one back,
 * the rule reports it and this file says what the fixed form looked like. The
 * `invalid` block is those same sinks as they were on the day the bump landed.
 */
it('no-raw-error-in-log: bans handing a caught value to console.error/warn', () => {
  ruleTester.run('no-raw-error-in-log', noRawErrorInLog as never, {
    valid: [
      // The eight sinks the tester named, in their fixed form.
      { code: "console.error('inviteMember failed:', loggableFailure(e));" },
      { code: "console.error('Public API request failed:', loggableFailure(error));" },
      { code: "console.error('automation cron failed:', loggableFailure(err));" },
      {
        code:
          'console.error(`automation "${core.key}" failed for org ${org.id}:`, ' +
          'loggableFailure(err));',
      },
      {
        code:
          "console.error('delivery read failed', { hasSnapshot, error: loggableFailure(error) });",
      },
      { code: "console.error('getProposalPreviewHtml failed:', loggableFailure(err));" },
      { code: 'console.error(`${logLabel} PDF render failed:`, loggableFailure(cause));' },
      { code: "console.error('acceptInvite failed:', loggableFailure(e));" },
      // A field the author CHOSE is a decision, not a spill.
      { code: "console.error('failed:', e.message);" },
      { code: "console.error('failed:', String(err));" },
      // Not a caught value, and not a console method this rule owns.
      { code: "console.error('plain message only');" },
      { code: "console.error('count', total);" },
      { code: 'console.log(error);' },
      { code: 'console.info(err);' },
      { code: 'logger.error(err);' },
      // A computed member access is not `console.error`.
      { code: "console['error'](err);" },
    ],
    invalid: [
      // The probe: the simplest form of the mistake.
      {
        code: "console.error('boom', err);",
        errors: [{ messageId: 'raw', data: { method: 'error', name: 'err' } }],
      },
      // The eight sinks as they stood when the bump landed.
      {
        code: "console.error('inviteMember failed:', e);",
        errors: [{ messageId: 'raw' }],
      },
      {
        code: "console.error('Public API request failed:', error);",
        errors: [{ messageId: 'raw' }],
      },
      {
        code: 'console.error(`${logLabel} PDF render failed:`, cause);',
        errors: [{ messageId: 'raw' }],
      },
      // Nested one level inside an object literal — how delivery.ts hid one.
      {
        code: "console.error('delivery read failed', { hasSnapshot, error });",
        errors: [{ messageId: 'raw' }],
      },
      // ...including the non-shorthand spelling, and alongside a spread.
      {
        code: "console.error('document object remove failed', { ...deleted, error: e });",
        errors: [{ messageId: 'raw' }],
      },
      // console.warn is the same hazard.
      {
        code: "console.warn('teardown unavailable', err);",
        errors: [{ messageId: 'raw', data: { method: 'warn', name: 'err' } }],
      },
      // A single argument, no label.
      { code: 'console.error(error);', errors: [{ messageId: 'raw' }] },
      // Two raw values in one call are two reports.
      {
        code: "console.error('both', e, { cause });",
        errors: [{ messageId: 'raw' }, { messageId: 'raw' }],
      },
    ],
  });
});

it('names every spelling this codebase gives a thrown value', () => {
  // The rule reports a NAME, so a spelling that is not listed is invisible.
  // Pinned so that adding one is a decision somebody takes on purpose.
  expect([...CAUGHT_VALUE_NAMES].sort()).toEqual([
    'cause',
    'e',
    'err',
    'error',
    'ex',
    'failure',
    'reason',
    'thrown',
  ]);
});
