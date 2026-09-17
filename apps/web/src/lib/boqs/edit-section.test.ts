// The two answers a section title can get BEFORE any database work, and the
// proof that they are two. `mutateInOrg` is replaced by a throw, so a case that
// reaches the transaction fails loudly instead of quietly needing a database.
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

import { addBoqSectionCore } from './edit';
import { MAX_DESCRIPTION } from './edit-input';
import type { OrgContext } from '@/lib/db/context';

const ctx = {
  orgId: 'org-1',
  userId: 'user-1',
  userEmail: 'studio@example.com',
  role: 'owner',
} as OrgContext;

const addSection = (title: string) => addBoqSectionCore(ctx, { boqId: 'boq-1', title });

describe('addBoqSectionCore: the section title', () => {
  it('asks for a name when there is none', async () => {
    for (const title of ['', '   ', '\n\t']) {
      await expect(addSection(title)).resolves.toEqual({
        ok: false,
        error: 'section_name_required',
      });
    }
  });

  it('says the name is TOO LONG when there is one', async () => {
    // The studio typed a name. Answering "a section needs a name" sends them
    // looking for an empty box that is not empty.
    await expect(addSection('x'.repeat(MAX_DESCRIPTION + 1))).resolves.toEqual({
      ok: false,
      error: 'section_name_too_long',
    });
  });

  // W3-9. Code points, the unit Postgres counts. 200 astral characters are 400
  // UTF-16 units: refused by `.length`, stored by the database.
  it('measures the title cap in CODE POINTS, not UTF-16 units', async () => {
    const atCap = '\u{1F9F1}'.repeat(MAX_DESCRIPTION);
    expect(atCap.length).toBe(MAX_DESCRIPTION * 2);
    // At the cap it gets PAST both guards and reaches the transaction.
    await expect(addSection(atCap)).rejects.toThrow(/before any transaction opens/);
    await expect(addSection('\u{1F9F1}'.repeat(MAX_DESCRIPTION + 1))).resolves.toEqual({
      ok: false,
      error: 'section_name_too_long',
    });
  });

  it('accepts a title at exactly the cap — and then needs the database', async () => {
    // Proof that the boundary is inclusive AND that nothing above refuses early:
    // the only way past both guards is into the transaction, which throws here.
    await expect(addSection('x'.repeat(MAX_DESCRIPTION))).rejects.toThrow(
      /before any transaction opens/,
    );
  });
});
