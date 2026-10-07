import { describe, expect, it } from 'vitest';
import { schemaScriptFailureLines } from './script-failure';

// The operator must be able to tell "stop and ask" from "re-run later" from the
// printed lines alone (B12 F3). Errors are shaped as drizzle-orm 0.45 throws
// them: a wrapper whose message is the whole SQL, the driver error on `cause`.

function wrapped(code: string, message: string): Error {
  const driver = Object.assign(new Error(message), { code, detail: 'Failing row contains (secret)' });
  return Object.assign(new Error('Failed query: -- 0057 ... the whole file\nparams: '), {
    cause: driver,
  });
}

describe('schemaScriptFailureLines', () => {
  it('23514 says STOP, with the code and the driver message, never the SQL or the row', () => {
    const lines = schemaScriptFailureLines(
      'migrate',
      wrapped('23514', 'check constraint "engagement_events_chosen_position_pairs" of relation "engagement_events" is violated by some row'),
    );
    expect(lines).toEqual([
      'Migration failed: SQLSTATE 23514: check constraint "engagement_events_chosen_position_pairs" of relation "engagement_events" is violated by some row',
      'Migration failed: STOP, tell the lead (a CHECK refused existing rows; the whole batch rolled back, nothing was changed).',
    ]);
    expect(lines.join('\n')).not.toContain('Failed query');
    expect(lines.join('\n')).not.toContain('secret');
  });

  it.each(['55P03', '40P01'])('%s is a lock wait or deadlock, safe to re-run', (code) => {
    expect(schemaScriptFailureLines('migrate', wrapped(code, 'canceling statement due to lock timeout'))[1]).toBe(
      'Migration failed: lock wait or deadlock, safe to re-run at a quieter moment (the whole batch rolled back, nothing was changed).',
    );
  });

  it('apply-rls names what a failed file leaves behind', () => {
    expect(schemaScriptFailureLines('apply-rls', wrapped('40P01', 'deadlock detected'))).toEqual([
      'apply-rls failed: SQLSTATE 40P01: deadlock detected',
      'apply-rls failed: lock wait or deadlock, safe to re-run at a quieter moment (this file rolled back; the files before it stay applied).',
    ]);
  });

  it('a bare driver error and an error with no code both still print', () => {
    expect(schemaScriptFailureLines('apply-rls', Object.assign(new Error('x'), { code: '42703' }))[0]).toBe(
      'apply-rls failed: SQLSTATE 42703: x',
    );
    expect(schemaScriptFailureLines('migrate', new Error('ECONNREFUSED'))).toEqual([
      'Migration failed: SQLSTATE none: ECONNREFUSED',
      'Migration failed: tell the lead before running anything else (the whole batch rolled back, nothing was changed).',
    ]);
  });
});
