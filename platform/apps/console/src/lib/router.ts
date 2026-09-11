import { useCallback, useEffect, useState } from "react";

/**
 * Minimal history-API router.
 *
 * The console has four public paths (`/`, `/login`, `/signup`, `/verify`) and
 * one authenticated area that does its own view switching. A routing library
 * would add a dependency and a bundle for something this file does in forty
 * lines, so it stays first-party.
 *
 * The server already serves `index.html` for any non-`/api` path, so deep
 * links and refreshes resolve here rather than 404ing.
 */

function currentPath(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname || "/";
}

export function useRoute(): [string, (to: string, opts?: { replace?: boolean }) => void] {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    // Back/forward buttons bypass navigate(), so the listener is what keeps the
    // rendered view honest about the address bar.
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to: string, opts?: { replace?: boolean }) => {
    if (to === currentPath()) return;
    if (opts?.replace) window.history.replaceState({}, "", to);
    else window.history.pushState({}, "", to);
    setPath(to);
    // A client-side navigation that leaves you mid-page reads as broken, since
    // the browser's own scroll restoration does not apply.
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  return [path, navigate];
}

/** Reads a query parameter from the current URL. */
export function queryParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}
