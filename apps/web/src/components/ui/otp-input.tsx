'use client';

import {
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from 'react';
import { cn } from '@/lib/utils';

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  autoFocus?: boolean;
  className?: string;
}

export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  ariaLabel,
  autoFocus,
  className,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const chars = Array.from({ length }, (_, i) => value[i] ?? '');

  const focus = (i: number) => {
    const idx = Math.max(0, Math.min(length - 1, i));
    const el = refs.current[idx];
    el?.focus();
    el?.select();
  };

  const emit = (next: string) => {
    onChange(next);
    if (next.length === length) onComplete?.(next);
  };

  const handleChange = (i: number, e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) return; // deletions are handled on keydown
    const arr = chars.slice();
    let cursor = i;
    for (const d of raw) {
      if (cursor >= length) break;
      arr[cursor] = d;
      cursor += 1;
    }
    emit(arr.join('').slice(0, length));
    focus(cursor);
  };

  const handleKeyDown = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const arr = chars.slice();
      if (arr[i]) {
        arr[i] = '';
        emit(arr.join(''));
      } else if (i > 0) {
        arr[i - 1] = '';
        emit(arr.join(''));
        focus(i - 1);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      focus(i - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      focus(i + 1);
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const digits = e.clipboardData
      .getData('text')
      .replace(/\D/g, '')
      .slice(0, length);
    if (!digits) return;
    emit(digits);
    focus(digits.length - 1);
  };

  return (
    // ALWAYS LTR: OTP digits read left-to-right in both locales.
    <div
      dir="ltr"
      role="group"
      aria-label={ariaLabel}
      className={cn('flex items-center gap-2', className)}
    >
      {chars.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={c}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          autoFocus={autoFocus && i === 0}
          aria-label={`digit ${i + 1} of ${length}`}
          className="size-12 rounded-xl border border-input bg-background text-center text-lg font-semibold tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        />
      ))}
    </div>
  );
}
