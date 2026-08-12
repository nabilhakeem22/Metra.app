'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Fires once when the element scrolls into view (IntersectionObserver). Returns
 * a ref to attach and the boolean. Never resets — first-load reveal only.
 */
export function useInView<T extends Element = HTMLDivElement>(
  options?: IntersectionObserverInit,
): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        io.disconnect();
      }
    }, options);
    io.observe(el);
    return () => io.disconnect();
  }, [options]);

  return [ref, inView];
}
