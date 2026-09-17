// ESLint rule: forbid a `'use client'` module from VALUE-importing a server-side
// registry barrel.
//
// WHY: this rule exists because the exact mistake it bans took production down.
// `engagement-command-card.tsx` (a client component) imported the value
// `MONEY_GUARD_MILESTONE` from the guards BARREL, `@/lib/engagements/guards`. The
// barrel re-exports `GUARDS` and the transition registry, so the bundler pulled the
// entire guard engine into the client chunk. The result was a server-side render
// exception on every cockpit load — a blank page with nothing but a digest
// (383510524) to debug from, because Next redacts server-component errors.
//
// The fix was to import the leaf (`@/lib/engagements/guards/money`) instead, which
// carries the same constant with none of the registry. Nothing prevented a repeat,
// so this rule does.
//
// WHAT IS BANNED: a VALUE import from a listed barrel, in a file whose first
// statement is `'use client'`.
//
// WHAT IS NOT BANNED, deliberately:
//   • `import type { … }` — erased at compile time, reaches no bundle. Client
//     components legitimately type-import from server modules all over this
//     codebase, and banning that would be noise.
//   • Importing the LEAF a constant actually lives in (`…/guards/money`). That is
//     the prescribed fix, so it must stay legal.
//   • Server components and server actions — they are meant to use the barrel.
//
// TO EXTEND: every barrel under apps/web/src/lib is classified below — either
// BANNED (BARRELS) or a deliberate client-callable RPC surface
// (CLIENT_RPC_BARRELS) — and a test asserts that the classification is COMPLETE
// (apps/web/src/lib/eslint-no-server-registry-in-client.test.ts). An allowlist
// that has to be remembered is one that rots, and it rotted the moment wave 5
// added two barrels nobody added here. A client component that wants a constant
// out of a banned barrel imports the LEAF instead; that is always available, and
// it is the fix this rule exists to enforce.

/** The barrels a `'use client'` module may not value-import. */
export const BARRELS = new Set([
  '@/lib/boqs/core',
  '@/lib/boqs/edit',
  '@/lib/contracts/core',
  '@/lib/contracts/lifecycle',
  '@/lib/contracts/queries',
  '@/lib/dashboard/queries',
  '@/lib/engagements/executor',
  '@/lib/engagements/guards',
  '@/lib/engagements/public',
  '@/lib/engagements/queries',
  '@/lib/engagements/transitions',
  '@/lib/projects/core',
  '@/lib/proposals/core',
  '@/lib/proposals/lifecycle',
  '@/lib/proposals/queries',
  '@/lib/variations/core',
  '@/lib/variations/lifecycle',
  '@/lib/variations/queries',
]);

/**
 * The deliberate exceptions: a SERVER-ACTION barrel IS the RPC surface a client
 * component is supposed to call. Next replaces each export with a stub, so no
 * server code follows it into the bundle — that is how every form on this site
 * submits, across 18 call sites today.
 *
 * Listed rather than inferred from a `'use server'` directive, so that a third
 * one is a DECISION somebody takes and not a directive somebody copied.
 */
export const CLIENT_RPC_BARRELS = new Set([
  '@/lib/engagements/actions',
  '@/lib/team/actions',
]);

/** Is this file a client component? (`'use client'` in the directive prologue.) */
function isClientModule(sourceCode) {
  for (const node of sourceCode.ast.body) {
    if (
      node.type !== 'ExpressionStatement' ||
      node.expression?.type !== 'Literal' ||
      typeof node.expression.value !== 'string'
    ) {
      // The prologue is over at the first non-directive statement.
      return false;
    }
    if (node.expression.value === 'use client') return true;
  }
  return false;
}

export const noServerRegistryInClient = {
  meta: {
    type: 'problem',
    docs: {
      description:
        "forbid value-importing a server registry barrel from a 'use client' module",
    },
    schema: [],
    messages: {
      barrel:
        "Client component value-imports '{{ barrel }}'. That barrel re-exports the " +
        'registry, so the whole guard engine lands in the client bundle and the ' +
        'page fails to render (this caused a production outage). Import the leaf ' +
        'module the value actually lives in, or use `import type` if you only need ' +
        'the type.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    if (!isClientModule(sourceCode)) return {};

    return {
      ImportDeclaration(node) {
        // `import type { X } from …` is erased — never a bundling hazard.
        if (node.importKind === 'type') return;
        const barrel = node.source.value;
        if (typeof barrel !== 'string' || !BARRELS.has(barrel)) return;
        // An import whose every specifier is `type` is also fully erased.
        const hasValueSpecifier = node.specifiers.some(
          (spec) => spec.importKind !== 'type',
        );
        if (!hasValueSpecifier) return;
        context.report({ node, messageId: 'barrel', data: { barrel } });
      },
    };
  },
};
