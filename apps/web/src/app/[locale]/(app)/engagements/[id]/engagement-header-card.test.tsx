import { describe, expect, test } from 'vitest';
import type { EngagementHeader } from '@/lib/engagements/queries';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { EngagementHeaderCard } from './engagement-header-card';

const header: EngagementHeader = {
  id: 'e-1',
  number: 14,
  titleAr: null,
  titleEn: 'Villa',
  clientId: 'c-1',
  projectId: 'p-1',
  clientNameEn: 'Acme',
  clientNameAr: null,
  projectNameEn: 'Tower',
  projectNameAr: null,
  state: 'design_3d',
  designFee: '100000.0000',
  offPlan: true,
  asBuiltDue: true,
  freeRevisionN: 3,
  revisionCount: 0,
  freeDesignRevisionN: 3,
  designRevisionCount: 0,
  romLow: null,
  romHigh: null,
  romIssuedAt: null,
  conceptLockedAt: '2026-05-01T00:00:00.000Z',
  renderManifestHash: null,
  rendersReadyAt: null,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-06-10T00:00:00.000Z',
};

describe('the delivery header chips speak the StatusChip tones', () => {
  test('brand is the status chip alone; concept locked is done, the rest neutral', () => {
    const { container } = renderWithIntl(
      <EngagementHeaderCard header={header} shared={false} status={{ kind: 'waitingClient', days: 3 }} />,
      { locale: 'en' },
    );
    const toneOf = (key: string) =>
      [...container.querySelectorAll('[data-tone]')]
        .find((chip) => chip.textContent === messageAt('en', key))
        ?.getAttribute('data-tone');
    expect(toneOf('engagements.conceptLocked')).toBe('done');
    expect(toneOf('engagements.asBuiltDue')).toBe('neutral');
    expect(toneOf('engagements.offPlan.offPlan')).toBe('neutral');
    const branded = [...container.querySelectorAll('[data-tone]')].filter((chip) =>
      /brand-tint|brand-ink/.test(chip.className),
    );
    expect(branded).toHaveLength(0);
  });
});
