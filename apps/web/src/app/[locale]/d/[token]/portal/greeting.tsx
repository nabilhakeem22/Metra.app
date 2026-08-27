'use client';

import { useTranslations } from 'next-intl';

/**
 * "Hello, {client} 👋" + the project title. The greeting line is omitted entirely
 * when the client name is unknown (a null client must never render "Hello, ").
 */
export function Greeting({
  clientName,
  title,
}: {
  clientName: string;
  title: string;
}) {
  const t = useTranslations('delivery');
  if (!clientName && !title) return null;
  return (
    <div className="space-y-1 px-1">
      {clientName && (
        <p className="text-sm text-muted-foreground">
          {t('greeting', { name: clientName })}
        </p>
      )}
      {title && <h1 className="text-xl font-semibold tracking-tight">{title}</h1>}
    </div>
  );
}
