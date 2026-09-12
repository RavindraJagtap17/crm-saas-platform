import { useEffect, useRef, useState } from "react";

/**
 * Adds an `.is-visible` class (via the returned boolean) the first time an
 * element scrolls into view — used to drive marketing.css's subtle
 * fade/slide-in reveals. Fires once and disconnects; a section that's
 * already on screen at load (e.g. the hero) is marked visible immediately
 * rather than waiting on the observer. prefers-reduced-motion is handled
 * entirely in CSS (the transition itself is removed), so this hook doesn't
 * need to special-case it.
 */
export function useRevealOnScroll() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }

    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, visible];
}
