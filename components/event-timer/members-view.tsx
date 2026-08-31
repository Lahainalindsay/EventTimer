"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Copy, MailPlus, Trash2 } from "lucide-react";
import type { EventData, EventMember } from "@/lib/types";

const ROLES: EventMember["role"][] = ["producer", "operator", "viewer"];

interface MembersViewProps {
  event: EventData;
  sessionUserId: string;
  members: EventMember[];
  onLoad: (eventId: string) => Promise<EventMember[]>;
  onInvite: (eventId: string, email: string, role: string) => Promise<{ link: string }>;
  onRemove: (memberId: string) => Promise<void>;
  onChangeRole: (memberId: string, role: string) => Promise<void>;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export function MembersView({
  event,
  sessionUserId,
  members,
  onLoad,
  onInvite,
  onRemove,
  onChangeRole,
}: MembersViewProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<EventMember["role"]>("operator");
  const [inviteLink, setInviteLink] = useState("");
  const [busy, setBusy] = useState(false);

  const isOwner = event.ownerId === sessionUserId;
  const selfMembership = useMemo(
    () => members.find((member) => member.user_id === sessionUserId),
    [members, sessionUserId],
  );

  useEffect(() => {
    void onLoad(event.id);
  }, [event.id, onLoad]);

  const submitInvite = async (event_: FormEvent<HTMLFormElement>) => {
    event_.preventDefault();
    setBusy(true);
    const result = await onInvite(event.id, email, role);
    setInviteLink(result.link);
    setEmail("");
    setRole("operator");
    setBusy(false);
  };

  const copyInvite = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
  };

  return (
    <section className="members-panel">
      <div className="workspace-heading members-heading">
        <div>
          <div className="eyebrow">COLLABORATORS</div>
          <h1>{event.name}</h1>
          <p className="members-note">Invite links are generated here, but Event Timer does not send email automatically in Phase 5.</p>
        </div>
      </div>

      {isOwner && (
        <form className="members-invite" onSubmit={(event_) => void submitInvite(event_)}>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event_) => setEmail(event_.target.value)}
              placeholder="producer@example.com"
              required
            />
          </label>
          <label>
            Role
            <select value={role} onChange={(event_) => setRole(event_.target.value as EventMember["role"])}>
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" type="submit" disabled={busy}>
            <MailPlus size={16} /> {busy ? "Generating…" : "Generate invite link"}
          </button>
        </form>
      )}

      {inviteLink && (
        <div className="invite-link-card">
          <strong>Invite link ready</strong>
          <div className="invite-link-row">
            <code>{inviteLink}</code>
            <button className="button secondary" onClick={() => void copyInvite()}>
              <Copy size={16} /> Copy
            </button>
          </div>
        </div>
      )}

      <div className="members-list">
        {members.length ? members.map((member) => {
          const active = !!(member.user_id || member.accepted_at);
          return (
            <article key={member.id} className="member-card">
              <div className="member-card-main">
                <strong>{member.invited_email ?? member.user_id ?? "Pending invite"}</strong>
                <div className="member-meta">
                  <span className={`role-badge role-${member.role}`}>{member.role}</span>
                  <span className={`member-status ${active ? "active" : "pending"}`}>{active ? "Active" : "Pending"}</span>
                  <span>Invited {formatDate(member.invited_at)}</span>
                </div>
              </div>
              <div className="member-actions">
                {isOwner ? (
                  <>
                    <select value={member.role} onChange={(event_) => void onChangeRole(member.id, event_.target.value)}>
                      {(["owner", ...ROLES] as EventMember["role"][]).map((value) => (
                        <option key={value} value={value} disabled={value === "owner" && member.user_id !== event.ownerId}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <button className="icon-button danger" onClick={() => void onRemove(member.id)} aria-label="Remove member">
                      <Trash2 size={16} />
                    </button>
                  </>
                ) : member.id === selfMembership?.id ? (
                  <button className="button secondary" onClick={() => void onRemove(member.id)}>
                    Leave event
                  </button>
                ) : null}
              </div>
            </article>
          );
        }) : <div className="unavailable-card"><p>No collaborators yet.</p></div>}
      </div>
    </section>
  );
}
