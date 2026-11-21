import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Every colour is a CSS variable (src/index.css) so themes swap without touching
// components. `<alpha-value>` keeps utilities like bg-surface/50 working.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const family = (n) => ({ fg: v(`${n}-fg`), bg: v(`${n}-bg`), line: v(`${n}-line`), solid: v(`${n}-solid`) });

/** @type {import('tailwindcss').Config} */
export default {
  content: [join(here, 'index.html'), join(here, 'src/**/*.{js,jsx}')],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      canvas: v('canvas'),
      surface: v('surface'),
      subtle: v('subtle'),
      muted: v('muted'),
      line: v('line'),
      'line-strong': v('line-strong'),
      fg: v('fg'),
      'fg-2': v('fg-2'),
      'fg-3': v('fg-3'),
      primary: v('primary'),
      'primary-hover': v('primary-hover'),
      'on-primary': v('on-primary'),
      focus: v('focus'),
      ok: family('ok'),
      warn: family('warn'),
      high: family('high'),
      danger: family('danger'),
      accent: { ...family('accent'), 'solid-hover': v('accent-solid-hover') },
      refer: family('refer'),
      mon: { bg: v('mon-bg'), text: v('mon-text'), trace: v('mon-trace'), warn: v('mon-trace-warn') },
    },
    extend: {
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / 0.06), 0 1px 1px rgb(var(--shadow) / 0.04)',
        pop: '0 8px 24px rgb(var(--shadow) / 0.14)',
      },
      // One type scale for all three dashboards.
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem' }],
        label: ['0.75rem', { lineHeight: '1rem' }],
        body: ['0.875rem', { lineHeight: '1.25rem' }],
        title: ['1.125rem', { lineHeight: '1.5rem', fontWeight: '600' }],
        display: ['1.5rem', { lineHeight: '2rem', fontWeight: '600' }],
        metric: ['2.25rem', { lineHeight: '2.5rem', fontWeight: '600' }],
      },
    },
  },
  plugins: [],
};
