import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// NOT 'use client': renders in server and client trees alike.
//
// The small label above a group of figures or rows. In Latin it is mono,
// uppercase and letter-spaced; Arabic has no case, no mono glyphs worth the
// name, and spacing tears its joined letters apart, so all three are `ltr:`
// only and the Arabic label is a plain semibold caption. Muted ink, not faint:
// it often sits on a tinted band, where faint fails contrast.
const SECTION_LABEL =
  'text-caption font-semibold text-[color:var(--text-muted)] ltr:font-mono ltr:uppercase ltr:tracking-[0.08em]';

export function SectionLabel({
  as: Element = 'p',
  className,
  children,
}: {
  as?: 'p' | 'span' | 'div' | 'h2' | 'h3';
  className?: string;
  children: ReactNode;
}) {
  return <Element className={cn(SECTION_LABEL, className)}>{children}</Element>;
}
