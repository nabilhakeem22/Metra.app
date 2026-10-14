import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { destructiveToasts } from './destructive-toasts';

const parse = (text: string) => ts.createSourceFile('probe.tsx', text, ts.ScriptTarget.Latest, true);

describe('destructiveToasts (F12)', () => {
  it('finds every spelling of a failure toast', () => {
    const spellings = [
      `toast({ title: t('x'), variant: 'destructive' });`,
      `toast({ title: t('x'), variant: "destructive" });`,
      'toast({ title: t(`x`), variant: `destructive` });',
      `toast({ title: t('x'), action: { label: 'Retry' }, variant: 'destructive' });`,
    ];
    for (const text of spellings) expect(destructiveToasts(parse(text)), text).toBe(1);
  });

  it('leaves a plain toast and a destructive confirm button alone', () => {
    expect(destructiveToasts(parse(`toast({ title: t('saved') });`))).toBe(0);
    expect(destructiveToasts(parse(`const b = <Button variant="destructive">Delete</Button>;`))).toBe(0);
  });
});
