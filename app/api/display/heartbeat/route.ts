import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { sha256Hex } from "@/lib/display-access";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Configuration error: missing service role" }, { status: 500 });
  }

  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  if (!body.token || typeof body.token !== "string") {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
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
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
