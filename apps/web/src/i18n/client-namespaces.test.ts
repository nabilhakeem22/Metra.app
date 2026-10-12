import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';
import { clientTranslationCalls } from '@/test/client-translation-scan';
import { loadSourceGraph, SRC_ROOT } from '@/test/source-graph';
import { CLIENT_NAMESPACES, scopedMessages, type MessageScope } from './client-namespaces';

// Round E: the browser gets only the namespaces its client components read.
// The guard: each scope's list EQUALS what the client code under its segment
// calls useTranslations with (missing = a MISSING_MESSAGE in production; extra =
// bytes for nothing), and every client call names its top-level namespace
// literally, so the scan can see it. Segments without their own scope fall to
// root, so a new route group is counted somewhere the day it appears.

const LOCALE_DIRECTORY = join(SRC_ROOT, 'app', '[locale]');

/** The app/[locale] directory whose layout renders each scope; root is the [locale] layout. */
const SCOPE_SEGMENTS: Record<MessageScope, string | null> = {
  root: null,
  studio: '(app)',
  auth: '(auth)',
  onboarding: 'onboarding',
  invite: 'invite',
  contractLink: 'c',
  deliveryLink: 'd',
  proposalLink: 'p',
  variationLink: 'v',
};

const graph = loadSourceGraph();
const scopes = Object.keys(SCOPE_SEGMENTS) as MessageScope[];
const scopedSegments = new Set(Object.values(SCOPE_SEGMENTS));

function filesUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return graph.files.has(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => filesUnder(join(path, name)));
}

function routeFiles(scope: MessageScope): string[] {
  const segment = SCOPE_SEGMENTS[scope];
  if (segment) return filesUnder(join(LOCALE_DIRECTORY, segment));
  return readdirSync(LOCALE_DIRECTORY)
    .filter((name) => !scopedSegments.has(name))
    .flatMap((name) => filesUnder(join(LOCALE_DIRECTORY, name)));
}

function usedNamespaces(scope: MessageScope): string[] {
  const calls = clientTranslationCalls(graph, routeFiles(scope));
  return [...new Set(calls.map((call) => call.namespace).filter((namespace) => namespace !== null))].sort();
}

describe('the messages each scope hands the browser', () => {
  it('every client useTranslations names its top-level namespace literally; no useMessages', () => {
    const unscoped = clientTranslationCalls(graph, [...graph.files.keys()])
      .filter((call) => call.namespace === null)
      .map((call) => `${call.path}: ${call.hook}(${call.argument})`);
    expect(unscoped).toEqual([]);
  });

  it.each(scopes)('%s: the list equals what its client code reads', (scope) => {
    const used = usedNamespaces(scope);
    const declared: readonly string[] = CLIENT_NAMESPACES[scope];
    expect(used.filter((namespace) => !declared.includes(namespace)), 'used, not handed over').toEqual([]);
    expect(declared.filter((namespace) => !used.includes(namespace)), 'handed over, not used').toEqual([]);
  });

  it.each(scopes)('%s: every namespace exists in both catalogues', (scope) => {
    for (const namespace of CLIENT_NAMESPACES[scope]) {
      expect(en, `en ${namespace}`).toHaveProperty([namespace]);
      expect(ar, `ar-EG ${namespace}`).toHaveProperty([namespace]);
    }
  });

  it.each(scopes)('%s: its segment layout renders that scope', (scope) => {
    const segment = SCOPE_SEGMENTS[scope];
    const layout = join(LOCALE_DIRECTORY, ...(segment ? [segment] : []), 'layout.tsx');
    expect(readFileSync(layout, 'utf8')).toContain(`<ScopedIntlProvider scope="${scope}">`);
  });

  it('the scan sees through the route into the client bundle (it is not finding nothing)', () => {
    const calls = (scope: MessageScope) => clientTranslationCalls(graph, routeFiles(scope));
    expect(calls('auth')).toContainEqual(expect.objectContaining({ path: 'app/[locale]/(auth)/login/login-form.tsx', namespace: 'login' }));
    expect(calls('deliveryLink')).toContainEqual(
      expect.objectContaining({ path: 'app/[locale]/d/[token]/portal/delivery-notice.tsx', namespace: 'delivery' }),
    );
    expect(calls('studio')).toContainEqual(expect.objectContaining({ path: 'components/ui/field-hint.tsx', namespace: 'common' }));
  });

  it('scopedMessages keeps exactly the listed namespaces', () => {
    expect(Object.keys(scopedMessages(en, 'deliveryLink')).sort()).toEqual(['app', 'delivery']);
    expect(scopedMessages(en, 'deliveryLink').delivery).toBe(en.delivery);
    expect(scopedMessages({ app: { name: 'x' } }, 'deliveryLink')).toEqual({ app: { name: 'x' } });
  });
});
