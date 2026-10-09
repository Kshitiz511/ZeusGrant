import { useEffect } from "react";
import { SiteNav } from "@/components/site/SiteNav";
import type { LegalDoc } from "@/content/legal";

export function LegalPage({
  doc,
  onNavigate,
}: {
  doc: LegalDoc;
  onNavigate: (to: string) => void;
}) {
  useEffect(() => {
    document.title = `${doc.title} · Zeus`;
    window.scrollTo(0, 0);
  }, [doc]);

  return (
    <div className="min-h-dvh bg-background">
      <SiteNav onNavigate={onNavigate} />
      <main className="mx-auto w-full max-w-3xl px-5 pb-24 pt-32 sm:px-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">{doc.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated {doc.updated}</p>
        {doc.sections.map((s) => (
          <section key={s.heading} className="mt-10">
            <h2 className="text-lg font-bold text-ink">{s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p.slice(0, 40)} className="mt-3 text-sm leading-relaxed text-foreground/85">
                {p}
              </p>
            ))}
          </section>
        ))}
        <div className="mt-14 flex gap-6 border-t border-border/60 pt-6 text-sm">
          <button className="text-primary hover:underline" onClick={() => onNavigate("/")}>
            Home
          </button>
          <button
            className="text-primary hover:underline"
            onClick={() => onNavigate(doc.path === "/privacy" ? "/terms" : "/privacy")}
          >
            {doc.path === "/privacy" ? "Terms of Service" : "Privacy Policy"}
          </button>
        </div>
      </main>
    </div>
  );
}
