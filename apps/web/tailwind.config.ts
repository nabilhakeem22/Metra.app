import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

// Logical-properties-first. Physical left/right utilities are banned by ESLint;
// use ms-/me-/ps-/pe-/start-/end-/text-start/text-end instead. Tailwind emits
// these as margin-inline-start etc, which flip automatically with dir.
const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        ar: ['var(--font-ar)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
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
        },
        // Snap Line variance-ladder + status fills.
        set: 'hsl(var(--set))',
        datum: 'hsl(var(--datum))',
        track: 'hsl(var(--track))',
        fill: {
          DEFAULT: 'hsl(var(--fill))',
          ok: 'hsl(var(--fill-ok))',
        },
        spill: 'hsl(var(--spill))',
      },
      boxShadow: {
        soft: '0 1px 2px 0 hsl(225 11% 7% / 0.05), 0 2px 6px -2px hsl(225 11% 7% / 0.08)',
        card: '0 4px 14px -4px hsl(225 11% 7% / 0.13)',
      },
      // Zero radius everywhere (Snap Line: sharp blocks, no escape hatch).
      borderRadius: {
        '2xl': '0',
        xl: '0',
        lg: '0',
        md: '0',
        sm: '0',
      },
    },
  },
  plugins: [animate],
};

export default config;
