import { cn } from "@/lib/utils";

/** Zeus Consulting "Z" mark, ported verbatim from the legacy app. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("h-8 w-8", className)} aria-hidden="true">
      <path d="M8 4h20v14H8z" fill="currentColor" />
      <path d="M32 4h24L20 46h24v14H8L44 18H32z" fill="currentColor" />
    </svg>
  );
}

export function Logo({
  className,
  tone = "dark",
}: {
  className?: string;
  tone?: "dark" | "light";
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className={cn("h-8 w-8", tone === "light" ? "text-primary-foreground" : "text-primary")} />
      <span className="flex flex-col leading-none">
        <span
          className={cn(
            "text-[13px] font-extrabold tracking-[0.14em]",
            tone === "light" ? "text-primary-foreground" : "text-ink",
          )}
        >
          ZEUS CONSULTING
        </span>
        <span
          className={cn(
            "mt-1 text-[10px] font-semibold tracking-[0.2em]",
            tone === "light" ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          GRANTMATCH INNOVATION
        </span>
      </span>
    </span>
  );
}
