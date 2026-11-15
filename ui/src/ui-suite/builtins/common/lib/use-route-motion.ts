import { useEffect, useRef } from 'react';

/** Animate presentation without remounting the viewport or its controllers. */
export function useRouteMotion(routeId: string, reduced: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(routeId);
  useEffect(() => {
    const changed = previous.current !== routeId;
    previous.current = routeId;
    const node = ref.current;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!changed || !node || reduced || preference.matches) return;
    // Opacity preserves fixed launch controls' containing block and hit targets.
    const animation = node.animate([{ opacity: .88 }, { opacity: 1 }], {
      duration: 170, easing: 'cubic-bezier(.16,1,.3,1)',
    });
    const stop = () => { if (preference.matches) animation.cancel(); };
    preference.addEventListener('change', stop);
    return () => {
      animation.cancel();
      preference.removeEventListener('change', stop);
    };
  }, [routeId, reduced]);
  return ref;
}
