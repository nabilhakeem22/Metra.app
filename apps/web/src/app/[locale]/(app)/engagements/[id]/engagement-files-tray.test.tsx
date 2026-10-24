import { screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { messageAt, renderWithIntl, type TestLocale } from '@/test/render-with-intl';
import { EngagementFilesTray } from './engagement-files-tray';

// The working-files badge grows with its word ("المقايسة" is far wider than
// "2D"), up to a cap past which it truncates and names the category on hover,
// so it never runs under the title beside it.

vi.mock('@/i18n/routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/routing')>()),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/engagements/actions', () => ({ getDeliverableUrl: vi.fn(), setArtifactClientVisible: vi.fn() }));
vi.mock('./upload-deliverable', () => ({ uploadDeliverableFile: vi.fn() }));

describe.each<TestLocale>(['en', 'ar-EG'])('the working files tray (%s)', (locale) => {
  test('each badge is as wide as its word, truncates past its cap, and names its category', () => {
    renderWithIntl(<EngagementFilesTray artifacts={[]} engagementId="e-1" canUpload={false} />, { locale });
    const word = messageAt(locale, 'engagements.files.badge.boq');
    const badge = screen.getByText(word).parentElement!;
    expect(badge.getAttribute('title')).toBe(messageAt(locale, 'engagements.files.category.boq'));
    const classes = badge.className.split(' ');
    expect(classes).toContain('min-w-[30px]');
    expect(classes).not.toContain('w-[30px]');
    expect(screen.getByText(word).className).toContain('truncate');
  });
});
