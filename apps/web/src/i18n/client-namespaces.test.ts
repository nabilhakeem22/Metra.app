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

/** Whether `namespace` is `ancestor` or lies under it. */
function within(namespace: string, ancestor: string): boolean {
  return namespace === ancestor || namespace.startsWith(`${ancestor}.`);
}

/** The sub-trees the client code under `scope` reads: each call's namespace,
 *  less any that another one already contains ('proposals' takes in
 *  'proposals.p'). One answer for one set of calls, so the list can be exact. */
function usedNamespaces(scope: MessageScope): string[] {
  const calls = clientTranslationCalls(graph, routeFiles(scope));
  const named = new Set(calls.map((call) => call.namespace).filter((namespace) => namespace !== null));
  return [...named].filter((namespace) => ![...named].some((other) => other !== namespace && within(namespace, other))).sort();
}

/** Every module the route files load, server or client. */
function modulesReached(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    pending.push(...graph.importsOf(path));
  }
  return [...seen];
}

/** The `errors.*` keys a quoted code in those modules can resolve to: a top
 *  level code, or a field code under `errors.field`. Generous on purpose (a
 *  literal that only looks like a code counts), so a missing key cannot slip. */
function errorKeysReached(entries: readonly string[]): Set<string> {
  const top = new Set(Object.keys(en.errors).filter((key) => typeof (en.errors as Record<string, unknown>)[key] === 'string'));
  const field = new Set(Object.keys(en.errors.field));
  const keys = new Set<string>(['errors.generic', 'errors.reference', 'errors.unreachable', 'errors.uncertain']);
  // The scope lists themselves name codes; they are the answer, not a source.
  for (const path of modulesReached(entries).filter((module) => !module.endsWith('client-namespaces.ts'))) {
    for (const [, literal] of graph.files.get(path)!.text.matchAll(/['"`]([a-z][a-z0-9_]*)['"`]/g)) {
      if (top.has(literal)) keys.add(`errors.${literal}`);
      if (field.has(literal)) keys.add('errors.field');
    }
  }
  return keys;
}

describe('the messages each scope hands the browser', () => {
  it('every client useTranslations names at least its top-level namespace literally; no useMessages', () => {
    const unscoped = clientTranslationCalls(graph, [...graph.files.keys()])
      .filter((call) => call.namespace === null)
      .map((call) => `${call.path}: ${call.hook}(${call.argument})`);
    expect(unscoped).toEqual([]);
  });

  it('no module of ours re-exports the hooks under another name (the scan could not follow it)', () => {
    const reexport = /export\s*(\*|\{[^}]*\buse(Translations|Messages)\b[^}]*\})\s*from\s*['"](next|use)-intl['"]/;
    const offenders = [...graph.files].filter(([, file]) => reexport.test(file.text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it.each(scopes)('%s: the list equals what its client code reads', (scope) => {
    const used = usedNamespaces(scope);
    const declared: readonly string[] = CLIENT_NAMESPACES[scope];
    // A namespace may be handed over whole, or (`errors` on the small routes)
    // as the sub-trees its code can show; the next test proves those suffice.
    const handedOver = (namespace: string) =>
      declared.includes(namespace) || declared.some((entry) => within(entry, namespace));
    expect(used.filter((namespace) => !handedOver(namespace)), 'used, not handed over').toEqual([]);
    expect(
      declared.filter((entry) => !used.some((namespace) => within(entry, namespace))),
      'handed over, not used',
    ).toEqual([]);
  });

  it.each(scopes)('%s: a partly handed-over errors namespace is exactly the codes its segment can show (R5)', (scope) => {
    const declared: readonly string[] = CLIENT_NAMESPACES[scope];
    const partial = declared.filter((entry) => entry.startsWith('errors.'));
    if (partial.length === 0) return;
    const reached = [...errorKeysReached(routeFiles(scope))];
    const missing = reached.filter((key) => !partial.some((entry) => within(key, entry)));
    expect(missing, 'codes the segment can answer that its scope does not hand over').toEqual([]);
    expect(partial.filter((entry) => !reached.includes(entry)), 'handed over, never answered').toEqual([]);
  });

  it.each(scopes)('%s: every namespace exists in both catalogues', (scope) => {
    for (const namespace of CLIENT_NAMESPACES[scope]) {
      expect(en, `en ${namespace}`).toHaveProperty(namespace.split('.'));
      expect(ar, `ar-EG ${namespace}`).toHaveProperty(namespace.split('.'));
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

  it.each([
    ['proposalLink', ['Margin is hidden for your role', 'Unit cost', 'Download internal PDF']],
    ['variationLink', ['Internal approval', 'Internally approved']],
  ] as const)('%s: only its own sub-tree, none of the studio wording around it (S1)', (scope, studioWords) => {
    const sent = JSON.stringify(scopedMessages(en, scope));
    for (const words of studioWords) {
      expect(JSON.stringify(en)).toContain(words);
      expect(sent).not.toContain(words);
    }
  });

  it('a sub-tree is copied under its own path, and the catalogue is left as it was', () => {
    const before = JSON.stringify(en);
    expect(scopedMessages(en, 'proposalLink')).toEqual({ portal: { errors: en.portal.errors }, proposals: { p: en.proposals.p } });
    expect(scopedMessages(en, 'auth').hints).toEqual({ auth: en.hints.auth });
    expect(JSON.stringify(en)).toBe(before);
  });

  it('scopedMessages keeps exactly the listed namespaces', () => {
    expect(Object.keys(scopedMessages(en, 'deliveryLink')).sort()).toEqual(['app', 'delivery', 'portal']);
    expect(scopedMessages(en, 'deliveryLink').delivery).toBe(en.delivery);
    // A dotted entry copies only its sub-tree: the portal's errors, nothing else under `portal`.
    expect(scopedMessages(en, 'deliveryLink').portal).toEqual({ errors: en.portal.errors });
    expect(scopedMessages({ app: { name: 'x' } }, 'deliveryLink')).toEqual({ app: { name: 'x' } });
  });
});
