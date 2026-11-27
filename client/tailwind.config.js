/** @type {import('tailwindcss').Config} */
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "..");

export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}",
    path.join(siteRoot, "console-ui/src/**/*.{js,ts,jsx,tsx}"),
    // Components moved to @zhin.js/console-ui (ADR 0063 P1a): its styles.css ships their utilities,
    // but generating them here as well keeps their order against the Console's own classes unchanged.
    path.join(siteRoot, "node_modules/@zhin.js/console-ui/dist/**/*.js"),
  ],
  theme: {
    extend: {
      colors: {
        // Soft-card roles of @zhin.js/console-ui 1.3.0 (ADR 0063 D34), for the Console's own classes.
        surface: 'hsl(var(--console-surface))',
        sunken: 'hsl(var(--console-sunken))',
        raised: 'hsl(var(--console-raised))',
        ink: 'hsl(var(--console-ink))',
        faint: 'hsl(var(--console-faint))',
        'primary-soft': 'hsl(var(--console-primary-soft))',
        ok: { DEFAULT: 'hsl(var(--console-ok))', bg: 'hsl(var(--console-ok-bg))' },
        warn: { DEFAULT: 'hsl(var(--console-warn))', bg: 'hsl(var(--console-warn-bg))' },
        danger: { DEFAULT: 'hsl(var(--console-danger))', bg: 'hsl(var(--console-danger-bg))' },
        progress: 'hsl(var(--console-progress))',
        ...Object.fromEntries([1, 2, 3, 4, 5].flatMap((n) => [[`tint-${n}`, `hsl(var(--console-tint-${n}))`], [`accent-${n}`, `hsl(var(--console-accent-${n}))`]])),
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'var(--console-radius-xl)',
      },
      boxShadow: {
        'console-xs': 'var(--console-shadow-xs)',
        'console-sm': 'var(--console-shadow-sm)',
        'console-md': 'var(--console-shadow-md)',
        'console-lg': 'var(--console-shadow-lg)',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "spin": "spin 1s linear infinite",
      },
    },
  },
  darkMode: "class",
  plugins: [],
}
