import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";

/**
 * Split-screen shell shared by sign-in and sign-up.
 *
 * Both pages carry the same brand panel, so it lives here rather than being
 * duplicated and then drifting apart the first time the copy is edited.
 */
export function AuthLayout({
  heading,
  subheading,
  pitch,
  children,
  footer,
}: {
  heading: string;
  subheading: string;
  pitch: { title: string; body: string };
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-brand-gradient p-12 text-primary-foreground lg:flex">
        {/* Decorative only: aria-hidden keeps it out of the accessibility tree
            so screen readers are not told about shapes that carry no meaning. */}
        <div aria-hidden className="bg-aurora pointer-events-none absolute inset-0 opacity-40" />
        <a href="/" className="relative z-10 w-fit">
          <Logo tone="light" />
        </a>
        <div className="relative z-10">
          <h1 className="max-w-md text-4xl font-extrabold leading-tight">{pitch.title}</h1>
          <p className="mt-4 max-w-md text-primary-foreground/80">{pitch.body}</p>
        </div>
        <p className="relative z-10 text-xs text-primary-foreground/70">
          © {new Date().getFullYear()} Zeus Consulting · GrantMatch Innovation
        </p>
      </div>

      <div className="flex items-center justify-center px-5 py-16">
        <div className="w-full max-w-md">
          <a href="/" className="block w-fit lg:hidden">
            <Logo />
          </a>
          <h2 className="mt-8 text-3xl font-extrabold text-foreground lg:mt-0">{heading}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{subheading}</p>
          {children}
          {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </main>
  );
}
