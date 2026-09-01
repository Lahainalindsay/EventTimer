import { NextRequest, NextResponse } from "next/server";
import { sha256Hex } from "@/lib/display-access";
import { formatUserError } from "@/lib/error-messages";
import { reportError } from "@/lib/observability";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export async function POST(request: NextRequest) {
  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: formatUserError("event_not_found") }, { status: 400 });
  }

  if (!body.token) {
    return NextResponse.json({ error: formatUserError("event_not_found") }, { status: 400 });
  }

  let serviceClient;
  try {
    serviceClient = createSupabaseServiceClient();
  } catch {
    reportError({ context: "invite_accept", message: "Missing service role configuration", timestamp: new Date().toISOString() });
    return NextResponse.json({ error: formatUserError("permission_denied") }, { status: 500 });
  }
  const tokenHash = await sha256Hex(body.token);
  const now = new Date().toISOString();

  const { data: member, error: memberError } = await serviceClient
    .from("event_members")
    .select("id,event_id,user_id,role,invited_email,invite_expires_at,accepted_at")
    .eq("invite_token_hash", tokenHash)
    .single();

  if (memberError || !member) {
    reportError({ context: "invite_accept", message: "Invite token lookup failed", timestamp: now });
    return NextResponse.json({ error: formatUserError("event_not_found") }, { status: 404 });
  }

  if (member.invite_expires_at && member.invite_expires_at <= now) {
    return NextResponse.json({ error: formatUserError("permission_denied") }, { status: 410 });
  }

  const authHeader = request.headers.get("authorization");
  let authUser: { id: string; email?: string | null } | null = null;
  if (authHeader?.startsWith("Bearer ")) {
    const jwt = authHeader.slice("Bearer ".length);
    const { data } = await serviceClient.auth.getUser(jwt);
    authUser = data.user ? { id: data.user.id, email: data.user.email } : null;
  }

  if (authUser && member.invited_email && authUser.email?.toLowerCase() !== member.invited_email.toLowerCase()) {
    return NextResponse.json({ error: formatUserError("permission_denied") }, { status: 403 });
  }

  if (authUser && member.user_id && member.user_id !== authUser.id) {
    return NextResponse.json({ error: formatUserError("permission_denied") }, { status: 403 });
  }

  if (!authUser) {
    return NextResponse.json({ ok: true, requires_login: true });
  }

  const updates = { user_id: authUser.id, accepted_at: member.accepted_at ?? now, invite_token_hash: null };

  const { error: updateError } = await serviceClient.from("event_members").update(updates).eq("id", member.id);
  if (updateError) {
    reportError({ context: "invite_accept", message: "Invite acceptance update failed", event_id: member.event_id, timestamp: now });
    return NextResponse.json({ error: formatUserError("permission_denied") }, { status: 500 });
  }

  return NextResponse.json({ ok: true, requires_login: !authUser });
}
