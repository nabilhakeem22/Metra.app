import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Link } from '@/i18n/routing';
import { describeFailure } from '@/lib/actions/error-message';
import type { ActionResult } from '@/lib/actions/result';

/**
 * What /market-book shows in place of a search the member's search budget
 * refused (lib/market-book/search-budget.ts): why, politely, and the way back
 * to the categories, which are never charged. No search ran.
 */
export async function MarketSearchRefused({ refusal }: { refusal: ActionResult }) {
  const [t, te] = await Promise.all([getTranslations('marketBook'), getTranslations('errors')]);
  return (
    <Card>
      <CardContent className="py-4">
        <EmptyState
          title={t('results.refused.title')}
          description={describeFailure(refusal, te)}
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/market-book">{t('results.refused.browse')}</Link>
            </Button>
          }
        />
      </CardContent>
    </Card>
  );
}
