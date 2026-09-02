import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - .mjs rule module has no types
import { noServerRegistryInClient } from '../../../../eslint-rules/no-server-registry-in-client.mjs';

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
          "import { MONEY_GUARD_MILESTONE } from '@/lib/engagements/guards/money';",
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
