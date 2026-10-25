import { Card, CardContent } from '@/components/ui/card';

// NOT 'use client': a plain module, rendered inside the rescue ledger's island.

/**
 * One rescue ledger figure: its title, the figure itself, the one line of
 * inputs it was counted from, and where it came from ("Based on your data").
 * The figure arrives FORMATTED (formatMoney or formatNumber, Latin digits) and
 * is set left to right, so Western numerals inside Arabic never reorder.
 */
export function RescueFigureCard({
  title,
  figure,
  inputs,
  sourceTag,
  hint,
}: {
  title: string;
  figure: string;
  inputs: string;
  sourceTag: string;
  /** An extra line under the inputs (the collected card's "never added to estimates"). */
  hint?: string;
}) {
  return (
    <Card className="h-full">
      <CardContent className="flex h-full flex-col gap-1.5 py-4">
        <p className="text-body font-medium text-muted-foreground">{title}</p>
        <p className="tabular text-heading font-bold text-foreground" dir="ltr">
          {figure}
        </p>
        <p className="text-caption text-muted-foreground">{inputs}</p>
        {hint && <p className="text-caption text-muted-foreground">{hint}</p>}
        <p className="mt-auto pt-1 text-caption font-semibold text-[color:var(--text-muted)]">{sourceTag}</p>
      </CardContent>
    </Card>
  );
}
