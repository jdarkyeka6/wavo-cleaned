import { useCallback, useLayoutEffect, useState } from "react";

/**
 * iOS exposes the notch / Dynamic Island / home-indicator insets only through
 * CSS `env(safe-area-inset-*)`, which JavaScript cannot read. A hidden probe
 * carrying those values as real padding *can* be measured, so that is how we
 * get at them.
 *
 * One probe is shared by every caller — it is a measuring stick, not state.
 */
let probe = null;
function safeAreaInsets() {
  if (typeof document === "undefined") {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  if (!probe || !probe.isConnected) {
    probe = document.createElement("div");
    probe.id = "safe-area-probe";
    probe.setAttribute("aria-hidden", "true");
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
  };
}

/**
 * Positions a dropdown against its trigger and keeps it inside the safe area.
 *
 * Returns a style object for a `position: fixed` panel that must be portalled
 * to <body>. Both halves of that matter:
 *
 *   - **fixed**, because the viewport is what the panel has to fit inside, and
 *     `absolute` measures against whatever ancestor happens to be positioned.
 *   - **portalled**, because a `transform` or a `backdrop-filter` on any
 *     ancestor makes that ancestor the containing block for fixed children.
 *     The sidebar is transformed (it slides in as a drawer on a phone), so a
 *     fixed panel left inside it would be positioned against the drawer and
 *     clipped by it.
 *
 * The panel prefers its left edge flush with the trigger's, shifts left when
 * that would run past the right edge, and is clamped so it can never cross
 * either edge or hide under the notch. Height is capped at whatever room is
 * actually left below the trigger, so a short landscape window scrolls the
 * list instead of running off the bottom of the screen.
 */
export function useAnchoredPanel(anchorRef, open, opts = {}) {
  const {
    width = 320,
    maxHeight = 440,
    gap = 8, // between the trigger and the panel
    margin = 8, // between the panel and the edge of the safe area
    minWidth = 200,
    minHeight = 160,
  } = opts;

  const [style, setStyle] = useState(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const a = anchor.getBoundingClientRect();
    const sa = safeAreaInsets();

    // visualViewport is the honest one once a keyboard or the iOS URL bar is
    // in the way; innerWidth/innerHeight keep reporting the full window.
    const vv = window.visualViewport;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;

    // The box the panel is allowed to occupy.
    const minX = sa.left + margin;
    const maxX = vw - sa.right - margin;
    const minY = sa.top + margin;
    const maxY = vh - sa.bottom - margin;

    // Never wider than the room available — on a 375px phone in landscape with
    // the notch on one side, 320px simply does not fit.
    const w = Math.max(minWidth, Math.min(width, maxX - minX));

    // Preferred position: left edges aligned. Shift left if the panel would
    // overhang the right, then clamp so shifting can't push it off the left.
    let left = a.left;
    if (left + w > maxX) left = maxX - w;
    if (left < minX) left = minX;

    const top = Math.max(minY, a.bottom + gap);
    const h = Math.max(minHeight, Math.min(maxHeight, maxY - top));

    setStyle({
      position: "fixed",
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(w),
      maxHeight: Math.round(h),
    });
  }, [anchorRef, width, maxHeight, gap, margin, minWidth, minHeight]);

  useLayoutEffect(() => {
    if (!open) return;
    place();

    // iOS fires resize on rotation before the new dimensions and the new
    // safe-area insets have settled, so a single measurement there can be
    // taken against the old orientation's numbers. Measure again on the next
    // frame and once more shortly after.
    let settle;
    const replace = () => {
      place();
      requestAnimationFrame(place);
      clearTimeout(settle);
      settle = setTimeout(place, 250);
    };
    window.addEventListener("resize", replace);
    window.addEventListener("orientationchange", replace);
    // Capture phase: the trigger lives in a scrollable sidebar, and a scroll
    // there does not bubble to window.
    window.addEventListener("scroll", place, true);
    const vv = window.visualViewport;
    vv?.addEventListener("resize", replace);
    vv?.addEventListener("scroll", place);

    return () => {
      window.removeEventListener("resize", replace);
      window.removeEventListener("orientationchange", replace);
      window.removeEventListener("scroll", place, true);
      vv?.removeEventListener("resize", replace);
      vv?.removeEventListener("scroll", place);
      clearTimeout(settle);
    };
  }, [open, place]);

  // Gated on `open` rather than cleared in the effect: a stale position must
  // never be handed out while the panel is shut, but resetting it with a
  // setState inside the effect would just cause an extra render.
  return open ? style : null;
}
