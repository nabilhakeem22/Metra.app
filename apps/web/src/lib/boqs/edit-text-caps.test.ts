// W3-9: every free-text cap on a BOQ measures CODE POINTS, the unit Postgres
// counts — not UTF-16 units. `mutateInOrg` is replaced by a throw, so a value
// that gets PAST the cap fails loudly instead of quietly needing a database.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/actions/mutate', () => ({
  mutateInOrg: () => {
    throw new Error('the refusal must happen before any transaction opens');
  },
  fail: (code: string) => {
    throw new Error(code);
  },
  requireInOrg: () => {
    throw new Error('not reached');
  },
}));

import { addBoqLineCore } from './edit';
import { MAX_DESCRIPTION } from './edit-input';
import { countCharacters } from '@/lib/validation/text';
import type { OrgContext } from '@/lib/db/context';

const ctx = {
  orgId: 'org-1',
  userId: 'user-1',
  userEmail: 'studio@example.com',
  role: 'owner',
} as OrgContext;

const addLine = (description: string) =>
  addBoqLineCore(ctx, { sectionId: 'section-1', description });

/** One astral character: two UTF-16 units, one code point. */
const ASTRAL = '\u{1F9F1}';

describe('addBoqLineCore: the description cap', () => {
  it('an ASCII description one past the cap is refused', async () => {
    await expect(addLine('x'.repeat(MAX_DESCRIPTION + 1))).resolves.toEqual({
      ok: false,
      error: 'description_too_long',
    });
  });

  it('EXACTLY MAX_DESCRIPTION astral characters is ACCEPTED and reaches the transaction', async () => {
    const atCap = ASTRAL.repeat(MAX_DESCRIPTION);
    expect(countCharacters(atCap)).toBe(MAX_DESCRIPTION);
    // Twice as long by `.length` — this is the value the old cap refused.
    expect(atCap.length).toBe(MAX_DESCRIPTION * 2);
    await expect(addLine(atCap)).rejects.toThrow(/before any transaction opens/);
  });

  it('ONE astral character past the cap is refused', async () => {
    await expect(addLine(ASTRAL.repeat(MAX_DESCRIPTION + 1))).resolves.toEqual({
      ok: false,
      error: 'description_too_long',
    });
  });

  it('an empty description is still a DIFFERENT refusal from an over-long one', async () => {
    await expect(addLine('   ')).resolves.toEqual({
      ok: false,
      error: 'description_required',
    });
  });
});
