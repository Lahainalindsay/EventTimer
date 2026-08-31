import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { generateAccessToken, sha256Hex } from "@/lib/display-access";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: "Server configuration error: missing service role" }, { status: 500 });
  }

  let body: { code?: string; event_id?: string };
  try {
    body = (await request.json()) as { code?: string; event_id?: string };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { code, event_id: eventId } = body;
  if (!code || !/^\d{6}$/.test(code) || !eventId) {
    return NextResponse.json({ error: "Invalid pairing code or event" }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const codeHash = await sha256Hex(code);
  const now = new Date().toISOString();

  const { data: display, error } = await supabase
    .from("event_displays")
    .select("id,event_id,display_type,pairing_code_hash,pairing_code_expires_at,revoked_at")
    .eq("event_id", eventId)
    .eq("pairing_code_hash", codeHash)
    .is("revoked_at", null)
    .gt("pairing_code_expires_at", now)
    .single();

  if (error || !display) {
    return NextResponse.json({ error: "Invalid, expired, or already-used pairing code" }, { status: 401 });
  }

  const accessToken = generateAccessToken();
  const accessTokenHash = await sha256Hex(accessToken);

  const { error: updateError } = await supabase
    .from("event_displays")
    .update({
      access_token_hash: accessTokenHash,
      pairing_code_hash: null,
      pairing_code_expires_at: null,
      connected_at: now,
      last_heartbeat_at: now,
      updated_at: now,
    })
    .eq("id", display.id);

  if (updateError) {
    return NextResponse.json({ error: "Failed to issue display token" }, { status: 500 });
  }

  return NextResponse.json({
    token: accessToken,
    display_type: display.display_type,
    event_id: display.event_id,
    display_url: `/display/${accessToken}`,
  });
}
