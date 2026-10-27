import type { Locale } from '@/i18n/routing';

// Cloudflare Turnstile, the sign-in challenge (go-live T3), as constants. PURE
// and CLIENT-SAFE, no env read: the CSP data module, the script loader and the
// login form's captcha hook share them. Supabase checks the token (its CAPTCHA
// setting); this app never validates a token with Cloudflare itself.

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

/** Cloudflare requires this exact URL (never proxied or self-hosted). */
export const TURNSTILE_SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit`;

/** Turnstile's language codes (lower case, per Cloudflare's supported-languages table). */
export const TURNSTILE_LANGUAGE: Readonly<Record<Locale, 'ar-eg' | 'en'>> = { 'ar-EG': 'ar-eg', en: 'en' };

/** Cloudflare: the 'flexible' widget is at least 300 px wide; a narrower slot gets 'compact' (150 x 140). */
export const TURNSTILE_FLEXIBLE_MIN_WIDTH_PX = 300;
