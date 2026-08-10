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
      },
      boxShadow: {
        soft: '0 1px 2px 0 hsl(220 43% 11% / 0.04), 0 2px 8px -2px hsl(220 43% 11% / 0.08)',
        card: '0 4px 20px -4px hsl(220 43% 11% / 0.10)',
      },
      borderRadius: {
        '2xl': 'calc(var(--radius) + 0.25rem)',
        xl: 'var(--radius)',
        lg: 'calc(var(--radius) - 0.25rem)',
        md: 'calc(var(--radius) - 0.5rem)',
        sm: 'calc(var(--radius) - 0.625rem)',
      },
    },
  },
  plugins: [animate],
};

export default config;
