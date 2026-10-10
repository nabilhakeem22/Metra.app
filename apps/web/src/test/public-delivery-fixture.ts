// TEST-ONLY. A complete client-page delivery as the mapper hands it to the
// page: a design at final approval with a deposit due and one shared PDF.
// Each test overrides what it is about.
import type { PublicDelivery } from '@/lib/engagements/public/types';

export const DOCUMENT_ID = '11111111-1111-4111-8111-111111111111';

export function publicDeliveryFixture(overrides: Partial<PublicDelivery> = {}): PublicDelivery {
  return {
    id: 'de-1',
    number: 7,
    stageKey: 'finalApproval',
    milestone: { index: 3, allComplete: false, closed: false },
    hero: { kind: 'action', group: 'design', showRomAck: false },
    offPlan: false,
    titleAr: 'شقة الزمالك',
    titleEn: 'Zamalek flat',
    createdAt: '2026-01-01T00:00:00Z',
    designFeeTotal: '120000.0000',
    rom: { low: '900000.0000', high: '1200000.0000' },
    shareExpiresAt: null,
    firm: { nameAr: 'ديوان', nameEn: 'Diwan Studio', hasLogo: false, phone: null, whatsappDigits: null },
    client: { nameAr: 'أحمد', nameEn: 'Ahmed' },
    paymentSchedule: [
      { milestone_kind: 'deposit', basis: 'amount', amount_due: '36000.0000', amount_cleared: '0.0000', status: 'due' },
    ],
    paymentClaim: { claimableMilestones: [{ milestoneKind: 'deposit', amountRemaining: '36000.0000', hasPendingClaim: false, claimedAt: null }] },
    documents: [{ id: DOCUMENT_ID, category: 'drawing', sharedAt: '2026-02-01T00:00:00Z', commentCount: 0, access: 'download', media: 'pdf' }],
    clientActions: ['approve_design', 'request_design_changes'],
    conceptOptions: [],
    conceptChoice: null,
    conceptDecision: null,
    paymentDetails: null,
    timeline: [],
    expectedOn: null,
    designDecision: null,
    handoverAcknowledgedAt: null,
    romAcknowledgedAt: null,
    lastUpdateAt: null,
    ...overrides,
  };
}
