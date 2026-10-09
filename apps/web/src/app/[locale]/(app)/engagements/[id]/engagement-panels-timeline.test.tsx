import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { TimelineTab } from './engagement-panels-timeline';

vi.mock('@/lib/engagements/actions', () => ({}));

const ar = (path: string) => messageAt('ar-EG', path);

function renderTab(props: { canRecordHandoffAck: boolean; handoffAckRecordedByOthers: boolean }) {
  renderWithIntl(
    <TimelineTab
      engagementId="e-1"
      transitions={[]}
      events={[]}
      clientActivity={[]}
      canRecordRomAck={false}
      canRetract={false}
      romSet={false}
      romIssued={false}
      pending={false}
      runAction={vi.fn()}
      {...props}
    />,
    { locale: 'ar-EG' },
  );
}

describe("recording the client's receipt of the handover (owner decision, Oct 9)", () => {
  test('a role that may not record it sees who does, and no button', () => {
    renderTab({ canRecordHandoffAck: false, handoffAckRecordedByOthers: true });
    expect(screen.getByText(ar('engagements.handoffAck.decidedBy'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: ar('engagements.handoffAck.title') })).toBeNull();
  });

  test('owner, admin or project manager get the button and no such line', () => {
    renderTab({ canRecordHandoffAck: true, handoffAckRecordedByOthers: false });
    expect(screen.getByRole('button', { name: ar('engagements.handoffAck.title') })).toBeTruthy();
    expect(screen.queryByText(ar('engagements.handoffAck.decidedBy'))).toBeNull();
  });
});
