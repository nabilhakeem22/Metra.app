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

  it('accepts a title at exactly the cap — and then needs the database', async () => {
    // Proof that the boundary is inclusive AND that nothing above refuses early:
    // the only way past both guards is into the transaction, which throws here.
    await expect(addSection('x'.repeat(MAX_DESCRIPTION))).rejects.toThrow(
      /before any transaction opens/,
    );
  });
});
