import { useSyncExternalStore } from "react";

// Matches the 720px breakpoint the stylesheet uses for "phone layout". Kept in
// one place so a component that needs to *behave* differently on a phone —
// not just look different — can't drift away from the CSS.
export const PHONE_QUERY = "(max-width: 720px)";

const mq = () => window.matchMedia(PHONE_QUERY);

function subscribe(onChange) {
  const m = mq();
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

/**
 * True while the viewport is phone-sized.
 *
 * useSyncExternalStore rather than useState + useEffect: matchMedia is an
 * external store, and reading it through this hook means there's no window
 * where the render has one answer and the effect corrects it afterwards.
 */
export function useIsPhone() {
  return useSyncExternalStore(
    subscribe,
    () => mq().matches,
    () => false // no viewport during SSR; assume desktop
  );
}
