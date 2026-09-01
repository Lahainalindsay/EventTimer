import { NextRequest, NextResponse } from "next/server";
import { generateAccessToken, sha256Hex } from "@/lib/display-access";
import { formatUserError } from "@/lib/error-messages";
import { reportError } from "@/lib/observability";
import { isPairingThrottledByStore, recordPairingAttemptInStore } from "@/lib/pairing-rate-limit";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

function clientAddress(request: NextRequest): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

export async function POST(request: NextRequest) {
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

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch {
    reportError({ context: "pairing_api", message: "Missing service role configuration", timestamp: new Date().toISOString() });
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 500 });
  }

  const rateLimitKey = await sha256Hex(`${clientAddress(request)}:${eventId}`);
  const rateLimit = await isPairingThrottledByStore(supabase, rateLimitKey);
  if (!rateLimit.available) {
    reportError({ context: "pairing_api", message: "Pairing rate-limit store unavailable", timestamp: new Date().toISOString() });
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 503 });
  }
  if (rateLimit.throttled) {
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 429 });
  }

  const codeHash = await sha256Hex(code);
  const now = new Date().toISOString();
  const accessToken = generateAccessToken();
  const accessTokenHash = await sha256Hex(accessToken);

  const { data: display, error } = await supabase
    .from("event_displays")
    .update({
      access_token_hash: accessTokenHash,
      pairing_code_hash: null,
      pairing_code_expires_at: null,
      connected_at: now,
      last_heartbeat_at: now,
      updated_at: now,
    })
    .eq("event_id", eventId)
    .eq("pairing_code_hash", codeHash)
    .is("revoked_at", null)
    .gt("pairing_code_expires_at", now)
    .select("id,event_id,display_type")
    .single();

  if (error || !display) {
    if (!(await recordPairingAttemptInStore(supabase, rateLimitKey, eventId, false))) {
      reportError({ context: "pairing_api", message: "Pairing rate-limit write failed", event_id: eventId, timestamp: now });
      return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 503 });
    }
    reportError({ context: "pairing_api", message: "Pairing lookup failed", event_id: eventId, timestamp: now });
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 401 });
  }

  if (!(await recordPairingAttemptInStore(supabase, rateLimitKey, eventId, true))) {
    reportError({ context: "pairing_api", message: "Pairing rate-limit write failed after exchange", event_id: eventId, timestamp: now });
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 503 });
  }
  return NextResponse.json({
    token: accessToken,
    display_type: display.display_type,
    event_id: display.event_id,
    display_url: `/display/${accessToken}`,
  });
}
