import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { useScrolledPast } from "@/lib/motion";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "#platform", label: "Platform" },
  { href: "#how", label: "How it works" },
  { href: "#security", label: "Security" },
  { href: "#pricing", label: "Pricing" },
];

/**
 * Marketing header.
 *
 * Transparent over the hero, then settles into glass once the page scrolls --
 * which keeps the hero uncluttered while guaranteeing contrast against whatever
 * section happens to be underneath it later.
 */
export function SiteNav({ onNavigate }: { onNavigate: (to: string) => void }) {
  const scrolled = useScrolledPast(16);
  const [open, setOpen] = useState(false);

  // An open drawer with a scrolling page behind it is disorienting, and on iOS
  // the background scroll is what the touch actually drives.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Escape is the expected way out of an overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const go = (to: string) => {
    setOpen(false);
    onNavigate(to);
  };

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-50 bg-background/95 backdrop-blur-xl transition-shadow duration-300 ease-out",
          // The bar is opaque at every scroll position. A transparent header
          // lets the page scroll through the navigation text, which is
          // unreadable; the scrolled state only adds separation from the
          // content passing beneath it.
          scrolled ? "border-b border-border/70 shadow-soft" : "border-b border-transparent",
        )}
      >
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8 md:h-[4.5rem]">
          <button
            onClick={() => go("/")}
            className="rounded-lg transition-opacity duration-200 hover:opacity-80"
            aria-label="Zeus Consulting home"
          >
            <Logo />
          </button>

          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors duration-200 hover:bg-primary/5 hover:text-ink"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 md:flex">
            <Button variant="ghost" onClick={() => go("/login")}>
              Sign in
            </Button>
            <Button variant="hero" onClick={() => go("/signup")}>
              Get started
            </Button>
          </div>

          <button
            className="rounded-lg p-2 text-ink transition-colors duration-200 hover:bg-primary/5 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-ink/20 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="glass-strong absolute inset-x-3 top-20 rounded-2xl p-4 animate-fade-up">
            <nav className="flex flex-col">
              {LINKS.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-4 py-3 text-sm font-semibold text-ink transition-colors duration-200 hover:bg-primary/5"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
              <Button variant="outline" className="w-full" onClick={() => go("/login")}>
                Sign in
              </Button>
              <Button variant="hero" className="w-full" onClick={() => go("/signup")}>
                Get started
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
