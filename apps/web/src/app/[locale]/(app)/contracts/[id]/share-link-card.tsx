'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** The client's contract link, shown once when the contract is issued, with a copy button. */
export function ShareLinkCard({ link }: { link: string }) {
  const t = useTranslations('contracts');
  return (
    <Card>
      <CardContent className="flex items-center gap-2 py-3 text-body">
        <span className="text-muted-foreground">{t('shareLink')}:</span>
        <code className="flex-1 truncate" dir="ltr">
          {link}
        </code>
        <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(link)}>
          {t('copyLink')}
        </Button>
      </CardContent>
    </Card>
  );
}
