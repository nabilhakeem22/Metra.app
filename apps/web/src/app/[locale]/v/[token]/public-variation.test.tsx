import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import type { PublicVariation } from '@/lib/variations/public';
import type { VariationDecidedKey } from '@/lib/variations/decided-message';
import { PublicVariationView } from './public-variation';

// ./actions is a 'use server' module that reaches for next/headers and the
// server-only variations reader. The unit config deliberately does NOT stub
// server-only, so it must be mocked here — an unmocked action module throwing on
// import is the harness telling the truth, not a bug to work around.
const respondToVariation = vi.hoisted(() => vi.fn());
vi.mock('./actions', () => ({ respondToVariation }));

const TOKEN = 'a-share-token';

function variationWith(
  overrides: Partial<PublicVariation> = {},
): PublicVariation {
  return {
    id: 'vo-1',
    number: 3,
    status: 'issued',
    title_ar: 'تعديل الجبس',
    title_en: 'Gypsum change',
    reason_ar: null,
    reason_en: null,
    net_delta: '12500.0000',
    currency: 'EGP',
    contract_number: 7,
    share_expires_at: null,
    contractActive: true,
    rejectionChannel: null,
    org: { name_ar: 'ستوديو', name_en: 'Studio', logo_file_id: null },
    lines: [
      {
        id: 'l-1',
        description_ar: 'قواطيع',
        description_en: 'Partitions',
        qty: '4.0000',
        unit: 'm2',
        unit_price: '3125.0000',
        discount_pct: '0.0000',
        line_total: '12500.0000',
        sort_order: 1,
      },
    ],
    ...overrides,
  };
}

function decidedText(key: VariationDecidedKey): string {
  return messageAt('ar-EG', `variations.client.${key}`);
}

beforeEach(() => {
  respondToVariation.mockReset();
});

/**
 * THE LADDER, RENDERED. Wave 2's F6 and wave 4's A10 both asserted this order in
 * a plan and proved it with nothing: `decided-message.test.ts` covers the pure
 * function, and until now no test had ever established that the portal page
 * actually reads it.
 */
describe('PublicVariationView — the client decision ladder', () => {
  const rows: {
    name: string;
    variation: Partial<PublicVariation>;
    expected: VariationDecidedKey;
  }[] = [
    {
      name: 'approved on a live contract',
      variation: { status: 'approved' },
      expected: 'approved',
    },
    {
      name: 'approved, then the contract was terminated (F6: approval outranks)',
      variation: { status: 'approved', contractActive: false },
      expected: 'approved',
    },
    {
      name: "THE DEFECT: rejected by the CLIENT on a dead contract — their own refusal, not contractInactive",
      variation: {
        status: 'rejected',
        contractActive: false,
        rejectionChannel: 'client',
      },
      expected: 'rejected',
    },
    {
      name: 'rejected by STAFF on a dead contract — the termination cascade',
      variation: {
        status: 'rejected',
        contractActive: false,
        rejectionChannel: 'staff',
      },
      expected: 'rejectedOnTermination',
    },
    {
      name: 'the LEGACY row: rejected, dead contract, no recorded channel (A2, no backfill)',
      variation: {
        status: 'rejected',
        contractActive: false,
        rejectionChannel: null,
      },
      expected: 'contractInactive',
    },
    {
      name: 'issued on a dead contract',
      variation: { status: 'issued', contractActive: false },
      expected: 'contractInactive',
    },
    {
      name: 'rejected on a LIVE contract with no recorded channel',
      variation: { status: 'rejected', rejectionChannel: null },
      expected: 'rejected',
    },
    {
      name: 'superseded — the fall-through',
      variation: { status: 'superseded' },
      expected: 'already',
    },
  ];

  test.each(rows)('$name renders variations.client.$expected', ({ variation, expected }) => {
    renderWithIntl(
      <PublicVariationView token={TOKEN} variation={variationWith(variation)} />,
    );
    expect(screen.getByText(decidedText(expected))).toBeTruthy();
    // A decided page offers no decision.
    expect(
      screen.queryByRole('button', {
        name: messageAt('ar-EG', 'variations.client.approve'),
      }),
    ).toBeNull();
  });

  test('the legacy null-channel row and the recorded-client row do NOT render the same sentence', () => {
    expect(decidedText('rejected')).not.toBe(decidedText('contractInactive'));
  });
});

describe('PublicVariationView — the open decision', () => {
  test('an issued VO on a live contract renders BOTH buttons', () => {
    renderWithIntl(
      <PublicVariationView token={TOKEN} variation={variationWith()} />,
    );
    expect(
      screen.getByRole('button', {
        name: messageAt('ar-EG', 'variations.client.approve'),
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: messageAt('ar-EG', 'variations.client.reject'),
      }),
    ).toBeTruthy();
  });

  test('rejecting sends the token, the decision and the typed name, then says rejected', async () => {
    respondToVariation.mockResolvedValue({ ok: true });
    renderWithIntl(
      <PublicVariationView token={TOKEN} variation={variationWith()} />,
    );

    fireEvent.change(
      screen.getByPlaceholderText(messageAt('ar-EG', 'variations.client.nameLabel')),
      { target: { value: 'منى' } },
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: messageAt('ar-EG', 'variations.client.reject'),
      }),
    );

    expect(await screen.findByText(decidedText('rejected'))).toBeTruthy();
    expect(respondToVariation).toHaveBeenCalledTimes(1);
    expect(respondToVariation).toHaveBeenCalledWith(TOKEN, 'reject', 'منى');
  });

  test('a token_expired refusal renders variations.client.expired', async () => {
    respondToVariation.mockResolvedValue({ ok: false, error: 'token_expired' });
    renderWithIntl(
      <PublicVariationView token={TOKEN} variation={variationWith()} />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: messageAt('ar-EG', 'variations.client.approve'),
      }),
    );
    expect(await screen.findByText(decidedText('expired'))).toBeTruthy();
    expect(respondToVariation).toHaveBeenCalledWith(TOKEN, 'approve', '');
  });

  test('an unrecognised refusal falls through to variations.client.invalid', async () => {
    respondToVariation.mockResolvedValue({ ok: false, error: 'not_found' });
    renderWithIntl(
      <PublicVariationView token={TOKEN} variation={variationWith()} />,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: messageAt('ar-EG', 'variations.client.reject'),
      }),
    );
    expect(await screen.findByText(decidedText('invalid'))).toBeTruthy();
  });

  test('variation === null renders variations.client.invalid and offers no buttons', () => {
    renderWithIntl(<PublicVariationView token={TOKEN} variation={null} />);
    expect(screen.getByText(decidedText('invalid'))).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(respondToVariation).not.toHaveBeenCalled();
  });
});
