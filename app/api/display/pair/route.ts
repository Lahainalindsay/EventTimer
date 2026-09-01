import { NextRequest, NextResponse } from "next/server";
import { generateAccessToken, sha256Hex } from "@/lib/display-access";
import { formatUserError } from "@/lib/error-messages";
import { reportError } from "@/lib/observability";
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
  const codeHash = await sha256Hex(code);
  const now = new Date().toISOString();
  const accessToken = generateAccessToken();
  const accessTokenHash = await sha256Hex(accessToken);

  const { data, error } = await supabase.rpc("pair_display_atomic", {
    p_event_id: eventId,
    p_pairing_code_hash: codeHash,
    p_access_token_hash: accessTokenHash,
    p_rate_limit_key: rateLimitKey,
    p_now: now,
    p_window_start: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    p_max_failed_attempts: 8,
  });

  if (error) {
    reportError({ context: "pairing_api", message: "Atomic pairing operation failed", event_id: eventId, timestamp: now });
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 503 });
  }

  const result = (data?.[0] ?? null) as { id: string | null; event_id: string | null; display_type: string | null; throttled: boolean } | null;
  if (result?.throttled) {
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 429 });
  }
  if (!result?.id || !result.event_id || !result.display_type) {
    reportError({ context: "pairing_api", message: "Pairing lookup failed", event_id: eventId, timestamp: now });
    return NextResponse.json({ error: formatUserError("pairing_failed") }, { status: 401 });
  }

  return NextResponse.json({
    token: accessToken,
    display_type: result.display_type,
    event_id: result.event_id,
    display_url: `/display/${accessToken}`,
  });
}
