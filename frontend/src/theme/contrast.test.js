// WCAG contrast gate for both themes. Parses the REAL tokens out of index.css so
// the test cannot drift from what ships. Text needs >= 4.5:1 (AA), UI marks >= 3:1.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

function block(selectorRe) {
  const m = css.match(selectorRe);
  if (!m) throw new Error(`block not found: ${selectorRe}`);
  const body = m[1];
  const out = {};
  for (const t of body.matchAll(/--([\w-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) out[t[1]] = [+t[2], +t[3], +t[4]];
  return out;
}

const light = block(/:root\s*\{([^}]*)\}/);
// Monitor-screen tokens are theme-invariant (a recessed dark display in both themes),
// so they live only in :root and are merged into the dark set here.
const MON = Object.fromEntries(Object.entries(light).filter(([k]) => k.startsWith('mon-')));
const darkAttr = { ...block(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/), ...MON };
const darkMedia = { ...block(/:root:not\(\[data-theme='light'\]\)\s*\{([^}]*)\}/), ...MON };

const lum = ([r, g, b]) => {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const FAMILIES = ['ok', 'warn', 'high', 'danger', 'accent', 'refer'];

// [foreground token, background token, minimum ratio, what it is]
const PAIRS = [
  ['fg', 'canvas', 4.5], ['fg', 'surface', 4.5], ['fg', 'muted', 4.5], ['fg', 'subtle', 4.5],
  ['fg-2', 'surface', 4.5], ['fg-2', 'muted', 4.5],
  ['fg-3', 'surface', 4.5], ['fg-3', 'canvas', 4.5], ['fg-3', 'muted', 4.5], ['fg-3', 'subtle', 4.5],
  ['on-primary', 'primary', 4.5], ['on-primary', 'primary-hover', 4.5],
  ['on-primary', 'accent-solid', 4.5], ['on-primary', 'danger-solid', 4.5], ['on-primary', 'ok-solid', 4.5],
  ['mon-text', 'mon-bg', 4.5], ['mon-trace', 'mon-bg', 3], ['mon-trace-warn', 'mon-bg', 3],
  ['line-strong', 'surface', 3], // input / button boundaries (WCAG 1.4.11)
  ['focus', 'surface', 3], ['focus', 'canvas', 3],
  ...FAMILIES.flatMap((f) => [
    [`${f}-fg`, 'surface', 4.5],
    [`${f}-fg`, `${f}-bg`, 4.5],
    [`${f}-fg`, 'muted', 4.5],
    [`${f}-solid`, 'surface', 3],
  ]),
];

describe.each([
  ['light', light],
  ['dark', darkAttr],
])('%s theme contrast', (_name, t) => {
  it.each(PAIRS)('%s on %s ≥ %s:1', (fg, bg, min) => {
    expect(t[fg], `token --${fg}`).toBeTruthy();
    expect(t[bg], `token --${bg}`).toBeTruthy();
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe('risk bands are distinguishable, not just dimmed', () => {
  const BANDS = ['ok', 'warn', 'high', 'danger'];
  it.each([['light', light], ['dark', darkAttr]])('%s: adjacent band solids differ in hue/lightness', (_n, t) => {
    for (let i = 0; i < BANDS.length - 1; i++) {
      const a = t[`${BANDS[i]}-solid`];
      const b = t[`${BANDS[i + 1]}-solid`];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      expect(dist, `${BANDS[i]} vs ${BANDS[i + 1]}`).toBeGreaterThan(55);
    }
  });
  it('dark band values are tuned separately from light (not the same colours)', () => {
    for (const b of BANDS) {
      expect(darkAttr[`${b}-solid`]).not.toEqual(light[`${b}-solid`]);
      expect(darkAttr[`${b}-fg`]).not.toEqual(light[`${b}-fg`]);
    }
  });
});

describe('system-dark block mirrors the explicit dark block', () => {
  it('defines identical tokens', () => {
    expect(darkMedia).toEqual(darkAttr);
  });
  it('both themes define the same token set', () => {
    expect(Object.keys(darkAttr).sort()).toEqual(Object.keys(light).sort());
  });
});
