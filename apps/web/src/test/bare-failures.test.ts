import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { bareFailures } from './bare-failures';

const count = (text: string) => bareFailures(ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)).length;

describe('bareFailures (F12)', () => {
  it('finds every spelling that builds generic', () => {
    const spellings = [
      `const a = { error: 'generic' };`,
      `const a = { error: "generic" };`,
      'const a = { error: `generic` };',
      `const a = { error: x.error ?? 'generic' };`,
      `const a = { ok: false, reason: 'generic' };`,
      `function f() { return 'generic'; }`,
      `setError('generic');`,
      `const code: ActionCode = 'generic';`,
      `const shown = t('generic');`,
    ];
    for (const text of spellings) expect(count(text), text).toBe(1);
  });

  it('finds invalid only where a failure is built', () => {
    expect(count(`return err('invalid');`)).toBe(1);
    expect(count(`const a = { error: "invalid" };`)).toBe(1);
    expect(count(`const READ = { ok: false, reason: 'invalid' };`)).toBe(0);
    expect(count(`function outcome() { return 'invalid'; }`)).toBe(0);
  });

  it('leaves a reading alone', () => {
    const readings = [
      `if (res.error === 'generic') show();`,
      `if (res.error !== "generic") show();`,
      `switch (code) { case 'generic': break; }`,
      `type Code = 'generic' | 'busy';`,
      `const map = { 'generic': 'server-error' };`,
      `if (['generic', 'busy'].includes(code)) retry();`,
    ];
    for (const text of readings) expect(count(text), text).toBe(0);
  });
});
