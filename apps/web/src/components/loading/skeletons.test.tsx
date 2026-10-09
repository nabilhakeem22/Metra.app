import { describe, expect, test } from 'vitest';
import DeliveryLoading from '@/app/[locale]/(app)/engagements/[id]/loading';
import ClientPageLoading from '@/app/[locale]/d/[token]/loading';
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

  test('the client page waits in its own shape: bar, greeting, 6-dot journey, hero, one card', () => {
    const { container } = renderWithIntl(<ClientPageLoading />, { locale: 'en' });
    const part = (name: string) => container.querySelector(`[data-skeleton="${name}"]`);
    // The bar: a 40 px mark, the name, and the 44 px language pill.
    expect(part('bar')!.querySelector('.size-10')).not.toBeNull();
    expect(part('bar')!.querySelector('.h-11.rounded-pill')).not.toBeNull();
    expect(part('greeting')).not.toBeNull();
    expect(part('journey')!.children).toHaveLength(6);
    // The hero: tag, headline, two lines and one 44 px button.
    expect(part('hero')!.children).toHaveLength(5);
    expect(part('hero')!.querySelectorAll('.h-11.rounded-pill')).toHaveLength(1);
    expect(container.querySelectorAll('[data-skeleton="card"]')).toHaveLength(1);
  });
});
