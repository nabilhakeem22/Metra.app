import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { translationCalls } from './client-translation-scan';

// Round E F4: the namespace scan finds the hooks however the file names them.
// Out of reach (see hookBindings): a hook re-exported by a module of ours,
// which client-namespaces.test.ts refuses outright.

function scan(source: string) {
  const file = ts.createSourceFile('probe.tsx', source, ts.ScriptTarget.Latest, true);
  return translationCalls(file, 'probe.tsx').map(({ hook, namespace }) => [hook, namespace]);
}

describe('the client translation scan', () => {
  it.each([
    ['the plain import', "import { useTranslations } from 'next-intl'; useTranslations('settings');"],
    ['an alias', "import { useTranslations as useT } from 'next-intl'; useT('settings');"],
    ['a namespace import', "import * as intl from 'next-intl'; intl.useTranslations('settings');"],
    ['use-intl', "import { useTranslations } from 'use-intl'; useTranslations('settings.card');"],
  ])('finds %s', (_label, source) => {
    expect(scan(source).map(([hook, namespace]) => [hook, namespace?.split('.')[0]])).toEqual([['useTranslations', 'settings']]);
  });

  it('finds an aliased useMessages, with no namespace', () => {
    expect(scan("import { useMessages as useAll } from 'next-intl'; useAll();")).toEqual([['useMessages', null]]);
  });

  it('a computed namespace is null; a dotted one is kept whole, a template up to its last literal dot', () => {
    const source = "import { useTranslations } from 'next-intl'; useTranslations(name); useTranslations('proposals.p'); useTranslations(`delivery.hero.${x}`);";
    expect(scan(source)).toEqual([
      ['useTranslations', null],
      ['useTranslations', 'proposals.p'],
      ['useTranslations', 'delivery.hero'],
    ]);
  });

  it('a function of the same name that is not the hook is not counted', () => {
    expect(scan("function useTranslations(x: string) { return x; } useTranslations('settings');")).toEqual([]);
  });
});
