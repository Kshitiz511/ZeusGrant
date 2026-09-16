import { Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useIsTenantAdmin } from "@/lib/hooks";

// Account and workspace settings.
//
// This page previously fell through to "Nothing here yet", which is a poor
// thing to show someone who clicked Settings. It now shows what we actually
// know, and is honest about the parts that are not built rather than offering
// controls that quietly do nothing.

export function SettingsView({ onNavigate }: { onNavigate: (key: string) => void }) {
  const { identity, logout } = useAuth();
  const { role, isOwner } = useIsTenantAdmin();

  if (!identity) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <Section title="You" description="How you appear to the rest of your workspace.">
        <Field label="Email" value={identity.email} />
        <Field
          label="Your role"
          value={
            <Badge variant={isOwner ? "default" : "secondary"} className="capitalize">
              {role ?? "member"}
            </Badge>
          }
        />
      </Section>

      <Section
        title="Workspace"
        description="Everyone you invite shares this workspace and everything in it."
      >
        <Field label="Name" value={identity.tenantName} />
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => onNavigate("/team")}>
            Manage people
          </Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate("/usage")}>
            View usage
          </Button>
          <Button variant="outline" size="sm" onClick={() => onNavigate("/billing")}>
            Plans &amp; billing
          </Button>
        </div>
      </Section>

      <PasswordSection />

      <Section title="Session" description="Signs you out on this device only.">
        <Button variant="outline" onClick={() => void logout()}>
          Sign out
        </Button>
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

/**
 * Changing a password requires sending mail, and outbound mail is not reliable
 * in production yet. Rather than show a form that would appear to work and then
 * strand the user without a password, this states the situation plainly.
 * Replace this block with the real form once delivery is fixed.
 */
function PasswordSection() {
  return (
    <Section title="Password" description="Changing your password is not available yet.">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
        <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          A password change has to be confirmed by email, and our outbound mail is not
          dependable yet. We would rather say so than hand you a form that leaves you
          locked out. Contact support and we will change it for you.
        </p>
      </div>
    </Section>
  );
}
