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
    return NextResponse.json({ error: formatUserError("display_revoked") }, { status: 400 });
  }

  if (!body.token || typeof body.token !== "string") {
    return NextResponse.json({ error: formatUserError("display_revoked") }, { status: 400 });
  }

  const tokenHash = await sha256Hex(body.token);
  const now = new Date().toISOString();

  let data: { id: string } | null = null;
  let error: unknown = null;
  try {
    const result = await createSupabaseServiceClient()
      .from("event_displays")
      .update({ last_heartbeat_at: now, updated_at: now })
      .eq("access_token_hash", tokenHash)
      .is("revoked_at", null)
      .select("id")
      .maybeSingle();
    data = result.data;
    error = result.error;
  } catch {
    error = new Error("service configuration failed");
  }

  if (error) {
    reportError({ context: "display_heartbeat", message: "Heartbeat update failed", timestamp: now });
    return NextResponse.json({ error: formatUserError("display_revoked") }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: formatUserError("display_revoked") }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
