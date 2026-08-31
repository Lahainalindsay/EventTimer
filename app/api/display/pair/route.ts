import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { generateAccessToken, sha256Hex } from "@/lib/display-access";
import { formatUserError } from "@/lib/error-messages";
import { reportError } from "@/lib/observability";

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    reportError({ context: "pairing_api", message: "Missing service role configuration", timestamp: new Date().toISOString() });
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 500 });
  }

  let body: { code?: string; event_id?: string };
  try {
    body = (await request.json()) as { code?: string; event_id?: string };
  } catch {
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 400 });
  }

  const { code, event_id: eventId } = body;
  if (!code || !/^\d{6}$/.test(code) || !eventId) {
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 400 });
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
    reportError({ context: "pairing_api", message: "Pairing lookup failed", event_id: eventId, timestamp: now });
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 401 });
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
    reportError({ context: "pairing_api", message: "Failed to issue display token", event_id: eventId, display_id: display.id, timestamp: now });
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 500 });
  }

  return NextResponse.json({
    token: accessToken,
    display_type: display.display_type,
    event_id: display.event_id,
    display_url: `/display/${accessToken}`,
  });
}
