import { useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Crown,
  Loader2,
  Mail,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import {
  useChangeRole,
  useInviteMember,
  useInvites,
  useIsTenantAdmin,
  useMembers,
  useRemoveMember,
  useRevokeInvite,
  useSeats,
  useTransferOwnership,
} from "@/lib/hooks";
import type { Invite, Member, MemberRole } from "@/lib/types";

// Who is in this workspace and what they may do here.
//
// Everything on this screen is gated twice: the nav entry and these controls
// are hidden from non-admins, and every route behind them re-checks on the
// server. The hiding is courtesy — it stops a member being shown buttons that
// would only fail — and is never the thing keeping anyone out.
//
// Two states here are real and not hypothetical. Seats can be exhausted, which
// the server reports as 402 rather than 403 because the caller is allowed to
// invite and has simply run out of room. And invite email can fail to send, in
// which case the accept link is shown for the admin to pass on by hand.

const ROLE_HELP: Record<MemberRole, string> = {
  owner: "Full control, including billing and transferring ownership.",
  admin: "Can manage people and see usage. Cannot transfer ownership.",
  member: "Can use the workspace. Cannot manage people.",
};

export function TeamView() {
  const { isAdmin, isOwner, isLoading: roleLoading } = useIsTenantAdmin();

  if (roleLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAdmin) return <NotAnAdmin />;

  return (
    <div className="space-y-6">
      <SeatSummary />
      <MemberList isOwner={isOwner} />
      <PendingInvites />
    </div>
  );
}

function NotAnAdmin() {
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center">
      <Users className="mx-auto size-8 text-muted-foreground" />
      <h3 className="mt-3 font-bold text-foreground">Managed by your workspace admins</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
        Only an owner or admin can add people and change what they can do. Ask one of
        them if you need access changed.
      </p>
    </div>
  );
}

// --- seats ------------------------------------------------------------------

function SeatSummary() {
  const { data, isLoading } = useSeats();
  const [inviteOpen, setInviteOpen] = useState(false);

  if (isLoading) return <Skeleton className="h-24 w-full" />;
  if (!data) return null;

  const unlimited = data.limit === null;
  const full = !unlimited && (data.remaining ?? 0) <= 0;
  const taken = data.used + data.pending;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-foreground">
            {unlimited ? (
              <>{taken} in this workspace</>
            ) : (
              <>
                {taken} of {data.limit} seats used
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {data.used} member{data.used === 1 ? "" : "s"}
            {data.pending > 0 && (
              <>
                {" · "}
                {data.pending} pending invite{data.pending === 1 ? "" : "s"}, which hold a
                seat until accepted or revoked
              </>
            )}
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)} disabled={full}>
          <UserPlus /> Invite someone
        </Button>
      </div>

      {full && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <p className="text-xs text-foreground">
            Every seat on your plan is taken. Remove someone, revoke a pending invite, or
            move to a larger plan to add more people.
          </p>
        </div>
      )}

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}

// --- members ----------------------------------------------------------------

function MemberList({ isOwner }: { isOwner: boolean }) {
  const { data, isLoading, error } = useMembers();
  const { identity } = useAuth();
  const members = data ?? [];

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-destructive">
        {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-bold text-foreground">People</h2>
      </div>

      {members.length === 1 && (
        <p className="border-b border-border bg-muted/40 px-5 py-3 text-xs text-muted-foreground">
          It is just you here so far. Invite the people you work with and they will see
          the same contracts, obligations and matches.
        </p>
      )}

      <ul className="divide-y divide-border">
        {members.map((m) => (
          <MemberRow
            key={m.user_id}
            member={m}
            isSelf={m.user_id === identity?.userId}
            viewerIsOwner={isOwner}
          />
        ))}
      </ul>
    </div>
  );
}

function MemberRow({
  member,
  isSelf,
  viewerIsOwner,
}: {
  member: Member;
  isSelf: boolean;
  viewerIsOwner: boolean;
}) {
  const changeRole = useChangeRole();
  const remove = useRemoveMember();
  const transfer = useTransferOwnership();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [confirmTransfer, setConfirmTransfer] = useState(false);

  const isOwnerRow = member.role === "owner";
  // The owner row is immovable from here: the server refuses to demote or
  // remove it, and a workspace with no owner has nobody who can pay for it or
  // hand it on. Changing owner is the transfer action, which is deliberate and
  // confirmed rather than a dropdown away.
  const roleLocked = isOwnerRow || isSelf;
  const busy = changeRole.isPending || remove.isPending || transfer.isPending;
  const failure = changeRole.error ?? remove.error ?? transfer.error;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold text-foreground">
          {(member.full_name || member.email).slice(0, 2).toUpperCase()}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {member.full_name || member.email}
            {isSelf && <span className="ml-2 text-xs text-muted-foreground">You</span>}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {member.full_name ? `${member.email} · ` : ""}
            Joined {formatDate(member.created_at)}
          </p>
        </div>

        {roleLocked ? (
          <Badge variant={isOwnerRow ? "default" : "secondary"} className="capitalize">
            {isOwnerRow && <Crown className="mr-1 size-3" />}
            {member.role}
          </Badge>
        ) : (
          <select
            value={member.role}
            disabled={busy}
            onChange={(e) =>
              changeRole.mutate({
                userId: member.user_id,
                role: e.target.value as MemberRole,
              })
            }
            aria-label={`Role for ${member.email}`}
            className="h-8 rounded-lg border border-input bg-background px-2 text-xs font-medium text-foreground disabled:opacity-50"
          >
            <option value="admin">Admin</option>
            <option value="member">Member</option>
          </select>
        )}

        <div className="flex items-center gap-1">
          {viewerIsOwner && !isOwnerRow && !isSelf && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmTransfer(true)}
              title="Make this person the owner"
            >
              <Crown />
            </Button>
          )}
          {!isOwnerRow && !isSelf && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
              title={`Remove ${member.email}`}
            >
              {remove.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          )}
        </div>
      </div>

      {!roleLocked && (
        <p className="mt-1.5 pl-13 text-xs text-muted-foreground">{ROLE_HELP[member.role]}</p>
      )}

      {failure && (
        <p className="mt-2 text-xs text-destructive">{(failure as Error).message}</p>
      )}

      <Modal
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={`Remove ${member.full_name || member.email}?`}
        description="They lose access to this workspace immediately. Anything they created stays."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmRemove(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(member.user_id, { onSuccess: () => setConfirmRemove(false) })
            }
          >
            {remove.isPending && <Loader2 className="animate-spin" />}
            Remove
          </Button>
        </div>
      </Modal>

      <Modal
        open={confirmTransfer}
        onClose={() => setConfirmTransfer(false)}
        title={`Make ${member.full_name || member.email} the owner?`}
        description="You become an admin. Only the new owner can transfer ownership back, so be sure."
      >
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmTransfer(false)}>
            Cancel
          </Button>
          <Button
            disabled={transfer.isPending}
            onClick={() =>
              transfer.mutate(member.user_id, {
                onSuccess: () => setConfirmTransfer(false),
              })
            }
          >
            {transfer.isPending && <Loader2 className="animate-spin" />}
            Transfer ownership
          </Button>
        </div>
      </Modal>
    </li>
  );
}

// --- invites ----------------------------------------------------------------

function PendingInvites() {
  const { data, isLoading } = useInvites();
  const revoke = useRevokeInvite();
  const invites = data ?? [];

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (invites.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3.5">
        <h2 className="text-sm font-bold text-foreground">Pending invites</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Each one holds a seat until it is accepted, revoked, or expires.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {invites.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <Mail className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{invite.email}</p>
              <p className="text-xs text-muted-foreground">
                Invited as {invite.role}
                {invite.invited_by_email && ` by ${invite.invited_by_email}`} · expires{" "}
                {formatDate(invite.expires_at)}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(invite.id)}
              title={`Revoke the invite for ${invite.email}`}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InviteDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const invite = useInviteMember();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [created, setCreated] = useState<Invite | null>(null);

  const close = () => {
    setEmail("");
    setRole("member");
    setCreated(null);
    invite.reset();
    onClose();
  };

  // A full workspace is 402, not 403: the caller is permitted to invite and has
  // simply run out of room, so the useful thing to say is about the plan rather
  // than about permission.
  const seatLimit = invite.error instanceof ApiError && invite.error.status === 402;

  if (created) {
    return (
      <Modal
        open={open}
        onClose={close}
        title="Invite created"
        description={
          created.email_sent
            ? `We emailed ${created.email}. The link works for seven days.`
            : `We could not send the email to ${created.email}. Send them this link yourself — it works for seven days.`
        }
      >
        {!created.email_sent && created.accept_url && (
          <CopyLink url={created.accept_url} />
        )}
        <div className="mt-4 flex justify-end">
          <Button onClick={close}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite someone"
      description="They will get access to everything in this workspace."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          invite.mutate({ email: email.trim(), role }, { onSuccess: setCreated });
        }}
        className="space-y-4"
      >
        <div>
          <label htmlFor="invite-email" className="text-xs font-semibold text-foreground">
            Email address
          </label>
          <Input
            id="invite-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@organisation.org"
            className="mt-1.5"
          />
        </div>

        <div>
          <label htmlFor="invite-role" className="text-xs font-semibold text-foreground">
            Role
          </label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
            className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <p className="mt-1.5 text-xs text-muted-foreground">{ROLE_HELP[role]}</p>
        </div>

        {invite.error && (
          <p className="text-xs text-destructive">
            {seatLimit
              ? "Every seat on your plan is taken. Free one up or move to a larger plan."
              : (invite.error as Error).message}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={invite.isPending || !email.trim()}>
            {invite.isPending && <Loader2 className="animate-spin" />}
            Send invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The fallback when mail does not arrive. */
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2">
      <code className="min-w-0 flex-1 truncate text-xs text-foreground">{url}</code>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          void navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
