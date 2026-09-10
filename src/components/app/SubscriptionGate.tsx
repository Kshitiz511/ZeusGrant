import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Loader2, Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TRIAL_DAYS } from "@/lib/plans";

export function SubscriptionGate({
  loading,
  hasAccess,
  feature,
  children,
}: {
  loading: boolean;
  hasAccess: boolean;
  feature: string;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (hasAccess) return <>{children}</>;

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-8 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
        <Lock className="size-5 text-primary" />
      </div>
      <h2 className="mt-5 text-xl font-bold text-foreground">{feature} needs an active plan</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Start your {TRIAL_DAYS}-day free trial to unlock {feature.toLowerCase()}. You can cancel any time before
        the trial ends and you won&apos;t be charged.
      </p>
      <Button asChild className="mt-6" variant="hero">
        <Link to="/billing" search={{ plan: undefined, annual: false, checkout: undefined }}>
          <Sparkles className="mr-2 size-4" />
          Choose a plan
        </Link>
      </Button>
    </div>
  );
}
