import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs rule module has no types
import {
  BARRELS,
  CLIENT_RPC_BARRELS,
  noServerRegistryInClient,
} from '../../../../eslint-rules/no-server-registry-in-client.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser as never,
    parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
  },
});

it('no-server-registry-in-client: bans the barrel value-import that caused the outage', () => {
  ruleTester.run('no-server-registry-in-client', noServerRegistryInClient as never, {
    valid: [
      // The prescribed fix: import the LEAF the constant actually lives in.
      {
        code:
          "'use client';\n" +
          "import { MONEY_GUARD_MILESTONE } from '@/lib/engagements/guards/trigger-money-gate';",
      },
      // Type-only imports are erased at compile time and reach no bundle.
      {
        code:
          "'use client';\n" +
          "import type { GuardKey } from '@/lib/engagements/guards';",
      },
      // ...including the inline-specifier form.
      {
        code:
          "'use client';\n" +
          "import { type GuardKey } from '@/lib/engagements/guards';",
      },
      // A SERVER module may use the barrel freely — that is what it is for.
      { code: "import { GUARDS } from '@/lib/engagements/guards';" },
      // A 'use server' module likewise.
      {
        code:
          "'use server';\n" + "import { GUARDS } from '@/lib/engagements/guards';",
      },
      // An unrelated barrel is not this rule's business.
      {
        code: "'use client';\n" + "import { formatDate } from '@/lib/format/date';",
      },
    ],
    invalid: [
      {
        // The exact shape of the production incident.
        code:
          "'use client';\n" +
          "import { MONEY_GUARD_MILESTONE } from '@/lib/engagements/guards';",
        errors: [{ messageId: 'barrel' }],
      },
      {
        // A mixed import still lands a value specifier in the bundle.
        code:
          "'use client';\n" +
          "import { type GuardKey, GUARDS } from '@/lib/engagements/guards';",
        errors: [{ messageId: 'barrel' }],
      },
      {
        // The transitions registry is the other listed barrel.
        code:
          "'use client';\n" +
          "import { TRANSITIONS } from '@/lib/engagements/transitions';",
        errors: [{ messageId: 'barrel' }],
      },
      {
        // 'use client' can sit after other directives in the prologue.
        code:
          "'use strict';\n" +
          "'use client';\n" +
          "import { GUARDS } from '@/lib/engagements/guards';",
        errors: [{ messageId: 'barrel' }],
      },
    ],
  });
});

/**
 * S2: the allowlist is an EXACT-MATCH set, so it fails OPEN for every barrel
 * added after it -- and wave 5 added two (`@/lib/boqs/core`, `@/lib/boqs/edit`)
 * that nobody added here. The control that exists because this exact mistake
 * took production down silently stopped covering new barrels.
 *
 * This test is the thing that stops it rotting again: every barrel under
 * apps/web/src/lib must be CLASSIFIED — banned, or a deliberate client-callable
 * server-action surface — and adding one without classifying it reds the suite
 * rather than quietly widening the hole.
 */
it('no-server-registry-in-client: classifies every lib barrel, so the allowlist cannot rot', () => {
  const libRoot = fileURLToPath(new URL('.', import.meta.url));
  const found: string[] = [];
  (function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === 'index.ts') {
        const specifier = relative(libRoot, path).split(sep).join('/');
        found.push(`@/lib/${specifier.replace(/\/index\.ts$/, '')}`);
      }
    }
  })(libRoot);

  // A walk that finds nothing would pass vacuously.
  expect(found.length).toBeGreaterThan(10);
  const banned = BARRELS as Set<string>;
  const callable = CLIENT_RPC_BARRELS as Set<string>;
  const unclassified = found.filter(
    (barrel) => !banned.has(barrel) && !callable.has(barrel),
  );
  expect(unclassified).toEqual([]);
  // And no barrel is both banned and callable.
  expect([...callable].filter((barrel) => banned.has(barrel))).toEqual([]);
});
