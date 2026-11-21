// One rAF loop per canvas, shared plumbing for every sensor tile:
//   - DPR-aware: the backing store follows the CSS size via ResizeObserver, capped at
//     2x so a 4K display doesn't quadruple the fill cost. (A fixed-size canvas
//     stretched by CSS is why the old tiles looked soft.)
//   - re-reads its palette when the theme changes (canvas can't see CSS variables)
//   - follows prefers-reduced-motion live; painters skip decoration, keep data moving
//   - skips painting while off-screen
// Sample data NEVER enters React state: painters read `monitor` directly each frame.
import { useEffect, useRef } from 'react';
import { onThemeChange, reducedMotionQuery } from '../../lib/tokens.js';

export const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
export const MAX_DPR = 2;

// makePainter({ canvas, ctx, frame }) -> { paint(frame), resize?(frame), theme?(frame), dispose?() }
// frame = { ctx, w, h, dpr, now, dt, reduced, visible }  (w/h in CSS pixels)
export function useCanvasLoop(makePainter, deps = []) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const rm = reducedMotionQuery();
    const frame = { ctx, w: 0, h: 0, dpr: 1, now: 0, dt: 0, reduced: rm.matches, visible: true };
    const painter = makePainter({ canvas, ctx, frame });

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      Object.assign(frame, { w, h, dpr });
      painter.resize?.(frame);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const io = new IntersectionObserver(([e]) => {
      frame.visible = e.isIntersecting;
    });
    io.observe(canvas);

    const offTheme = onThemeChange(() => painter.theme?.(frame));
    const onRm = () => {
      frame.reduced = rm.matches;
    };
    rm.addEventListener('change', onRm);

    let raf = 0;
    let running = true;
    let last = performance.now();
    let reported = false;
    const loop = (now) => {
      if (!running) return;
      raf = requestAnimationFrame(loop); // schedule first: one bad frame must not stop the tile
      frame.dt = Math.min(0.1, (now - last) / 1000);
      frame.now = now;
      last = now;
      if (!frame.visible) return;
      try {
        ctx.setTransform(frame.dpr, 0, 0, frame.dpr, 0, 0);
        painter.paint(frame);
      } catch (e) {
        if (!reported) {
          reported = true; // once, not 60 times a second
          console.error('[sensor tile] paint failed:', e);
        }
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      offTheme();
      rm.removeEventListener('change', onRm);
      painter.dispose?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

// A rAF loop with no canvas, for tweened DOM readouts (the big numbers). `tick({ dt, now, reduced })`
// runs every frame and writes straight to DOM nodes through refs, so a 60 fps animation never
// re-renders React.
export function useFrameLoop(tick, deps = []) {
  useEffect(() => {
    const rm = reducedMotionQuery();
    let raf = 0;
    let running = true;
    let last = performance.now();
    let reported = false;
    const loop = (now) => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try {
        tick({ dt, now, reduced: rm.matches });
      } catch (e) {
        if (!reported) {
          reported = true;
          console.error('[sensor readout] tick failed:', e);
        }
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// Write text to a DOM node only when it changed (a per-frame textContent write that
// doesn't change anything still costs a style recalc in some engines).
export function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}
export function setColor(el, css) {
  if (el && el.__c !== css) {
    el.__c = css;
    el.style.color = css;
  }
}
