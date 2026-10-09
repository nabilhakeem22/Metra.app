'use client';

import { useTranslations } from 'next-intl';

/**
 * "Hello, {client} 👋" + the project title. The greeting line is omitted entirely
 * when the client name is unknown (a null client must never render "Hello, ").
 * The greeting and the title keep to one line each (the full title stays in the
 * element's `title`): measured at 1269x697, a 90-character title on two lines
 * still put the hero's headline at 313 px, past the 300 px the action must sit
 * within.
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
        <p className="truncate text-body text-muted-foreground">
          {t('greeting', { name: clientName })}
        </p>
      )}
      {title && (
        <h1 title={title} className="truncate text-heading font-semibold">
          {title}
        </h1>
      )}
    </div>
  );
}
