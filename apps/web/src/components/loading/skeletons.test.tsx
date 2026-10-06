import { describe, expect, test } from 'vitest';
import DeliveryLoading from '@/app/[locale]/(app)/engagements/[id]/loading';
import { messageAt, renderWithIntl } from '@/test/render-with-intl';
import { DashboardSkeleton } from './dashboard-skeleton';
import { DeliverySkeleton } from './delivery-skeleton';
import { DocumentSkeleton } from './document-skeleton';
import { DetailSkeleton, ListSkeleton, PageSkeleton } from './page-skeletons';
import { PortalSkeleton } from './portal-skeleton';
import { SettingsSkeleton } from './settings-skeleton';

const SKELETONS = {
  PageSkeleton,
  ListSkeleton,
  DetailSkeleton,
  DashboardSkeleton,
  DeliverySkeleton,
  DocumentSkeleton,
  SettingsSkeleton,
  PortalSkeleton,
};

describe('route skeletons', () => {
  test.each(Object.entries(SKELETONS))('%s is one status region named Loading', (_name, Shape) => {
    const { container } = renderWithIntl(<Shape />, { locale: 'en' });
    const regions = container.querySelectorAll('[role="status"]');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.getAttribute('aria-label')).toBe(messageAt('en', 'app.loading'));
  });

  test('the delivery route waits in the delivery shape: a spine band, no stat cards', () => {
    const { container } = renderWithIntl(<DeliveryLoading />, { locale: 'en' });
    const spine = container.querySelector('[data-skeleton="spine"]');
    expect(spine).not.toBeNull();
    expect(spine!.children).toHaveLength(8);
    expect(container.querySelector('.lg\\:grid-cols-4')).toBeNull();
  });
});
