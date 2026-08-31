import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sha256Hex } from "@/lib/display-access";
import { formatUserError } from "@/lib/error-messages";
import { reportError } from "@/lib/observability";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    reportError({ context: "display_heartbeat", message: "Missing service role configuration", timestamp: new Date().toISOString() });
    return NextResponse.json({ error: formatUserError("display_revoked") }, { status: 500 });
  }

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
  const supabase = createClient(supabaseUrl, supabaseKey);
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("event_displays")
    .update({ last_heartbeat_at: now, updated_at: now })
    .eq("access_token_hash", tokenHash)
    .is("revoked_at", null);

  if (error) {
    reportError({ context: "display_heartbeat", message: "Heartbeat update failed", timestamp: now });
    return NextResponse.json({ error: formatUserError("display_revoked") }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
