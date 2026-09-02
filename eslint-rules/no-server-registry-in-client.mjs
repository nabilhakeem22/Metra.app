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
// TO EXTEND: add the barrel's `@/`-style specifier to BARRELS below. A barrel
// belongs here when it re-exports a large registry AND also re-exports small
// constants a client component might plausibly want.

/** Barrels that pull a registry in behind an innocuous-looking constant. */
const BARRELS = new Set([
  '@/lib/engagements/guards',
  '@/lib/engagements/transitions',
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
