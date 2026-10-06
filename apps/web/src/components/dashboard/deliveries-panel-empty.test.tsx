import { describe, expect, test } from 'vitest';
import { screen } from '@testing-library/react';
import { deliveriesEmptyState } from '@/lib/dashboard/setup-step';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { DeliveriesPanelEmpty } from './deliveries-panel-empty';

const en = (path: string) => messageAt('en', path);
const NOTHING = { hasClient: false, hasProject: false, hasEngagement: false };

describe('DeliveriesPanelEmpty', () => {
  test('with zero clients an owner gets the reason and a button to /clients?new=1', () => {
    renderWithIntl(<DeliveriesPanelEmpty empty={deliveriesEmptyState('owner', NOTHING)} />, {
      locale: 'en',
    });
    expect(screen.getByText(en('dashboard.deliveries.emptyNoClient'))).toBeTruthy();
    expect(
      screen.getByRole('link', { name: en('dashboard.ctaAddClient') }).getAttribute('href'),
    ).toBe('/en/clients?new=1');
  });

  test('a viewer reads the reason with no link', () => {
    renderWithIntl(<DeliveriesPanelEmpty empty={deliveriesEmptyState('viewer', NOTHING)} />, {
      locale: 'en',
    });
    expect(screen.getByText(en('dashboard.deliveries.emptyNoClient'))).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('"every delivery is closed" only once one existed', () => {
    renderWithIntl(
      <DeliveriesPanelEmpty
        empty={deliveriesEmptyState('owner', { hasClient: true, hasProject: true, hasEngagement: true })}
      />,
      { locale: 'en' },
    );
    expect(screen.getByText(en('dashboard.deliveries.emptyAllClosed'))).toBeTruthy();
  });
});
