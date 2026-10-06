'use client';

import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/routing';

// The "Start delivery" form's empty states.

/** A prerequisite the studio has to add first, with the button that adds it. */
export function NeedFirst({ message, href, cta }: { message: string; href?: string; cta: string }) {
  return (
    <div className="space-y-2 rounded-item border bg-muted/40 p-3 text-body text-muted-foreground">
      <p>{message}</p>
      {href && (
        <Button asChild size="sm" variant="secondary">
          <Link href={href}>{cta}</Link>
        </Button>
      )}
    </div>
  );
}
