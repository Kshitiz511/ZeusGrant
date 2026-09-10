import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ADD_ONS, CONTRACT_ADD_ONS, DRAFT_ADD_ONS, type AddOn } from "@/lib/addons";
import { AddOnCheckout } from "@/components/AddOnCheckout";

type Props = {
  /** Show only the extra-draft add-ons (used on limit-reached prompts). */
  draftsOnly?: boolean;
  /** Show only the extra-contract-slot add-ons. */
  contractsOnly?: boolean;
  onPurchaseStarted?: () => void;
};

/** Contextual add-on purchase surface. Purchases always require confirmation. */
export function AddOnStore({ draftsOnly = false, contractsOnly = false, onPurchaseStarted }: Props) {
  const [confirming, setConfirming] = useState<AddOn | null>(null);
  const [buying, setBuying] = useState<AddOn | null>(null);
  const items = contractsOnly ? CONTRACT_ADD_ONS : draftsOnly ? DRAFT_ADD_ONS : ADD_ONS;


  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((addon) => (
          <Card key={addon.id} className="border-border">
            <CardContent className="flex h-full flex-col gap-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold">{addon.name}</p>
                <span className="whitespace-nowrap text-sm font-semibold text-primary">
                  ${addon.price}
                </span>
              </div>
              <p className="flex-1 text-xs text-muted-foreground">{addon.description}</p>
              <Button size="sm" variant="outline" onClick={() => setConfirming(addon)}>
                Purchase
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={!!confirming} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm purchase</DialogTitle>
            <DialogDescription>
              {confirming
                ? `${confirming.name} — one-time charge of $${confirming.price}. ${confirming.description}`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setBuying(confirming);
                setConfirming(null);
                onPurchaseStarted?.();
              }}
            >
              Continue to payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!buying} onOpenChange={(o) => !o && setBuying(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{buying?.name}</DialogTitle>
            <DialogDescription>
              Complete payment to add this to your account immediately.
            </DialogDescription>
          </DialogHeader>
          {buying ? <AddOnCheckout addonId={buying.id} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
