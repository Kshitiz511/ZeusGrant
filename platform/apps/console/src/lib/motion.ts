import { useEffect, useRef, useState } from "react";

/**
 * Scroll-driven motion primitives for the marketing page.
 *
 * Two things this file takes seriously:
 *
 * **Scroll handlers must not do layout work.** Reading `getBoundingClientRect`
 * on every scroll event forces synchronous layout and turns a smooth page into
 * a stuttering one. Everything here either uses IntersectionObserver (which the
 * browser computes off the main thread) or batches reads into a single
 * requestAnimationFrame per frame.
 *
 * **Motion is opt-out at the OS level.** `prefers-reduced-motion` is not a
 * nice-to-have; parallax is a genuine accessibility problem for people with
 * vestibular disorders. Both hooks degrade to fully static rather than merely
 * faster.
 */

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Reveals an element the first time it scrolls into view.
 *
 * Returns a ref to attach and the visibility flag. Pair with the `reveal`
 * utility class, which owns the actual transition.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(options?: {
  /** Fraction of the element that must be visible. Default 0.15. */
  threshold?: number;
  /** Delay in ms before revealing, for staggering siblings. */
  delay?: number;
}) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(() => prefersReducedMotion());

  useEffect(() => {
    const node = ref.current;
    if (!node || prefersReducedMotion()) return;

    // Older Safari and any non-browser render path lack the observer. Showing
    // the content unanimated is strictly better than hiding it forever.
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        // One-shot: re-animating on every scroll past is distracting, and it
        // keeps the observer from firing for the rest of the session.
        observer.disconnect();
        if (options?.delay) {
          window.setTimeout(() => setVisible(true), options.delay);
        } else {
          setVisible(true);
        }
      },
      {
        threshold: options?.threshold ?? 0.15,
        // Start slightly before the element is technically on screen so the
        // transition is already underway when the user reaches it.
        rootMargin: "0px 0px -80px 0px",
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [options?.threshold, options?.delay]);

  return { ref, visible };
}

/**
 * Vertical parallax offset in pixels, driven by page scroll.
 *
 * `speed` is a multiplier on scroll distance: 0.2 drifts gently behind the
 * content, negative values move against it. Values much above 0.35 start to
 * feel unmoored from the page.
 */
export function useParallax(speed = 0.2): number {
  const [offset, setOffset] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    const onScroll = () => {
      // Coalesce bursts of scroll events into one update per frame. Without
      // this the state setter can run dozens of times between paints, which is
      // pure wasted work.
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        setOffset(window.scrollY * speed);
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, [speed]);

  return offset;
}

/** True once the page has scrolled past `threshold` px. Drives the sticky nav. */
export function useScrolledPast(threshold = 12): boolean {
  const [past, setPast] = useState(false);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const onScroll = () => {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        setPast(window.scrollY > threshold);
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, [threshold]);

  return past;
}
