// Bridge between CSS custom properties and places CSS can't reach: <canvas> and
// SVG presentation attributes. Canvas needs concrete colours, so we read the
// computed variable and invalidate the cache whenever the theme changes
// (explicit toggle via data-theme, or the OS flipping while on "System").
let cache = new Map();
const listeners = new Set();
let watching = false;

function watch() {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const bump = () => {
    cache = new Map();
    strCache = new Map();
    listeners.forEach((fn) => fn());
  };
  new MutationObserver(bump).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', bump);
}

// "r g b" channel triple of a token, e.g. token('ok-solid') -> "21 128 61".
export function token(name) {
  let v = cache.get(name);
  if (v === undefined) {
    v = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || '128 128 128';
    cache.set(name, v);
  }
  return v;
}

// Concrete colour string for canvas: rgb('ok-solid', 0.4) -> "rgb(21 128 61 / 0.4)".
// Memoised (cleared with the token cache on theme change) because painters call it every frame.
let strCache = new Map();
export function rgb(name, alpha = 1) {
  alpha = Math.round(alpha * 100) / 100; // quantised: bounds the memo to ~100 entries per token
  const key = `${name}|${alpha}`;
  let v = strCache.get(key);
  if (v === undefined) {
    v = alpha >= 1 ? `rgb(${token(name)})` : `rgb(${token(name)} / ${alpha})`;
    strCache.set(key, v);
  }
  return v;
}

// Numeric [r, g, b] of a token, for animating between colours.
export function triple(name) {
  return token(name).split(' ').map(Number);
}

// "rgb(r g b / a)" from a (possibly mid-animation) numeric triple.
export const fromTriple = (t, alpha = 1) =>
  alpha >= 1 ? `rgb(${t[0] | 0} ${t[1] | 0} ${t[2] | 0})` : `rgb(${t[0] | 0} ${t[1] | 0} ${t[2] | 0} / ${alpha})`;

// Same colour for SVG / inline style / recharts props: resolves live, no JS re-read needed.
export function cssVar(name, alpha) {
  return alpha == null || alpha >= 1 ? `rgb(var(--${name}))` : `rgb(var(--${name}) / ${alpha})`;
}

// Subscribe a canvas painter so it re-reads its palette after a theme change.
export function onThemeChange(fn) {
  watch();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// prefers-reduced-motion as a live value (canvas loops read .matches each frame).
export function reducedMotionQuery() {
  return window.matchMedia('(prefers-reduced-motion: reduce)');
}
