import { BadgeCheck, Calculator, FileSignature, Hammer, PenLine, type LucideIcon } from 'lucide-react';
import type { ExecutionStepKey } from '@/lib/flow/phases/execution';

// One glyph per execution step, for the studio's rail and the client's alike.
// A plain module (never 'use client'), so either tree imports it. Decoration
// only: each sits beside its own label and is aria-hidden.
export const EXECUTION_STEP_ICON: Readonly<Record<ExecutionStepKey, LucideIcon>> = {
  contract: FileSignature,
  signature: PenLine,
  works: Hammer,
  final_account: Calculator,
  settled: BadgeCheck,
};
