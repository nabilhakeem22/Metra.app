import { createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeFailure, type Translate } from '@/lib/actions/error-message';
import ar from '@/messages/ar-EG.json';
import en from '@/messages/en.json';

// The sentence a paused person reads (security batch 3, P2): the server's own
// answer, formatted by the real next-intl formatter over both catalogues, the
// way the login form does it (describeFailure over the `errors` namespace).

vi.mock('server-only', () => ({}));
vi.mock('@/lib/cf/context', () => ({ isCloudflareRuntime: () => false, cfEnv: () => ({}) }));
const leaf = vi.hoisted(() => ({ readSignInPauseSeconds: vi.fn(), recordWrongSignInCode: vi.fn() }));
vi.mock('./sign-in-failures-db', () => leaf);

const { signInPauseRefusal } = await import('./sign-in-lockout');

function errorsTranslator(locale: 'en' | 'ar-EG'): Translate {
  return createTranslator({ locale, messages: locale === 'en' ? en : ar, namespace: 'errors' }) as unknown as Translate;
}

async function sentence(locale: 'en' | 'ar-EG', seconds: number): Promise<string> {
  leaf.readSignInPauseSeconds.mockResolvedValue(seconds);
  const refused = await signInPauseRefusal('mona@firm.example');
  return describeFailure(refused!, errorsTranslator(locale));
}

afterEach(() => vi.restoreAllMocks());

describe('the sign-in pause sentence', () => {
  const EN = 'Too many wrong codes were typed for this account, so signing in to it is paused. Try again in';
  const AR = 'اتكتب كود غلط مرات كتير للحساب ده، فتسجيل الدخول بيه متوقف مؤقتًا. جرّب تاني بعد';

  it.each([
    [45, '1 minute'],
    [61, '2 minutes'],
    [1500, '25 minutes'],
    [3600, '60 minutes'],
  ])('en: %i seconds left reads "%s"', async (seconds, wait) => {
    expect(await sentence('en', seconds)).toBe(`${EN} ${wait}.`);
  });

  it.each([
    [45, 'دقيقة'],
    [61, 'دقيقتين'],
    [180, '3 دقايق'],
    [600, '10 دقايق'],
    [660, '11 دقيقة'],
    [1500, '25 دقيقة'],
    [3600, '60 دقيقة'],
  ])('ar-EG: %i seconds left reads "%s", in Western digits', async (seconds, wait) => {
    const text = await sentence('ar-EG', seconds);
    expect(text).toBe(`${AR} ${wait}.`);
    expect(text).not.toMatch(/[٠-٩۰-۹—–]/);
  });
});
