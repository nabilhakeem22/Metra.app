/**
 * The two HTML helpers every PDF template needs, over the ONE app escaper.
 *
 * The templates each carried a private four-character `esc` that did NOT escape
 * the single quote, and two of them a private `pick`. So the same org name —
 * "Hassan & Sons", or an Arabic title with an apostrophe in its English
 * fallback — could render one way in an email and another in a PDF, and any
 * single-quoted attribute a future template introduced would have been a hole.
 */
import { escapeHtml } from '@/lib/html/escape';

/**
 * Escape a value for interpolation into PDF HTML, tolerating null/undefined.
 *
 * The null-tolerance is the whole reason this wrapper exists rather than calling
 * escapeHtml directly: every field on a document detail is nullable, and
 * `escapeHtml(null!)` would print the string "null" into a client's document.
 */
export function esc(value: string | null | undefined): string {
  return escapeHtml(value ?? '');
}

/**
 * The bilingual field the reader should see, ESCAPED. Prefers the locale's own
 * language and falls back to the other when it is absent or blank, because a
 * document with an empty title is worse than one in the wrong language.
 *
 * The name says `Escaped` on purpose: `pick` gave no hint that its result was
 * already safe, and both templates were escaping it a second time in the footer,
 * which is how "Hassan & Sons" came out as "Hassan &amp; Sons" on the page.
 */
export function pickEscaped(
  arabic: string | null,
  english: string | null,
  locale: string,
): string {
  const wantsArabic = locale.startsWith('ar');
  const preferred = wantsArabic ? arabic : english;
  const fallback = wantsArabic ? english : arabic;
  return esc((preferred && preferred.trim() ? preferred : fallback) ?? '');
}
