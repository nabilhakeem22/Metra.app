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
    extend: {
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
        soft: '0 1px 2px 0 hsl(198 40% 10% / 0.05), 0 2px 6px -2px hsl(198 40% 10% / 0.08)',
        card: '0 4px 14px -4px hsl(198 40% 10% / 0.13)',
        // Theme-aware: resolves to the light or dark glass shadow per data-theme.
        glass: 'var(--glass-shadow), var(--glass-inner)',
        'brand-glow': 'var(--brand-glow)',
      },
      borderRadius: {
        '2xl': 'calc(var(--radius) + 0.25rem)',
        xl: 'var(--radius)',
        lg: 'calc(var(--radius) - 0.25rem)',
        md: 'calc(var(--radius) - 0.5rem)',
        sm: 'calc(var(--radius) - 0.625rem)',
        frame: '26px',
        panel: '20px',
        bar: '18px',
        item: '13px',
        icon: '11px',
        pill: '999px',
      },
    },
  },
  plugins: [animate],
};

export default config;
