import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Logical-properties-first. Physical left/right utilities are banned by ESLint;
// use ms-/me-/ps-/pe-/start-/end-/text-start/text-end instead. Tailwind emits
// these as margin-inline-start etc, which flip automatically with dir.
const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    // THEME-LEVEL, not extend: these REPLACE Tailwind's scales, so text-xs ..
    // text-9xl, bare `rounded` and rounded-sm .. rounded-3xl generate no CSS.
    // The values live in globals.css (RTL and touch overrides sit beside them);
    // `metra/design-tokens-only` fails lint on any off-scale class. Weight is
    // not part of a token: callers add font-semibold / font-bold.
    fontSize: {
      caption: ['var(--fs-caption)', { lineHeight: 'var(--lh-caption)' }],
      small: ['var(--fs-small)', { lineHeight: 'var(--lh-small)' }],
      body: ['var(--fs-body)', { lineHeight: 'var(--lh-body)' }],
      title: [
        'var(--fs-title)',
        { lineHeight: 'var(--lh-title)', letterSpacing: 'var(--tracking-title)' },
      ],
      heading: [
        'var(--fs-heading)',
        { lineHeight: 'var(--lh-heading)', letterSpacing: 'var(--tracking-title)' },
      ],
      display: [
        'var(--fs-display)',
        { lineHeight: 'var(--lh-display)', letterSpacing: 'var(--tracking-display)' },
      ],
    },
    borderRadius: {
      none: '0',
      item: 'var(--r-item)',
      panel: 'var(--r-panel)',
      frame: 'var(--r-frame)',
      pill: 'var(--r-pill)',
      full: '9999px',
    },
    extend: {
      // Touch devices: `coarse:min-h-11` gives a 44px target where a finger is
      // the pointer, without growing the desktop layout.
      screens: { coarse: { raw: '(pointer: coarse)' } },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        manrope: ['var(--font-manrope)'],
        tajawal: ['var(--font-tajawal)'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          foreground: 'hsl(var(--brand-foreground))',
          strong: 'hsl(var(--brand-strong))',
          // Raw glass tokens (not HSL triplets) for tint chips / ink-on-tint.
          ink: 'var(--brand-ink)',
          tint: 'var(--brand-tint)',
        },
      },
      backdropBlur: {
        glass: '30px',
        'glass-sm': '14px',
      },
      boxShadow: {
        soft: '0 1px 2px 0 hsl(220 43% 16% / 0.05), 0 2px 6px -2px hsl(220 43% 16% / 0.08)',
        card: '0 4px 14px -4px hsl(220 43% 16% / 0.13)',
        // Theme-aware: resolves to the light or dark glass shadow per data-theme.
        glass: 'var(--glass-shadow), var(--glass-inner)',
        'brand-glow': 'var(--brand-glow)',
      },
    },
  },
  plugins: [animate],
};

export default config;
