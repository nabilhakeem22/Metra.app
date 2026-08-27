'use client';

import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

// The post-send share-link card: read-only link + copy button. The link is
// owned by the parent (ProposalBuilder); this child is presentational, driven
// by the passed value.
export function BuilderShareLink({
  t,
  link,
}: {
  t: ReturnType<typeof useTranslations<'proposals'>>;
  link: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 py-3">
        <span className="text-sm font-medium">{t('view.shareTitle')}:</span>
        <Input readOnly dir="ltr" value={link} className="max-w-md text-xs" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void navigator.clipboard?.writeText(link);
            toast({ title: t('toast.linkCopied') });
          }}
        >
          {t('view.copyLink')}
        </Button>
      </CardContent>
    </Card>
  );
}
