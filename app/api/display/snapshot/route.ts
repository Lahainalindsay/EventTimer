import { NextRequest, NextResponse } from "next/server";
import { formatUserError } from "@/lib/error-messages";
import { loadDisplaySnapshot } from "@/lib/display-snapshot";
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

  try {
    const snapshot = await loadDisplaySnapshot(createSupabaseServiceClient(), body.token, false);
    if (!snapshot) {
      return NextResponse.json({ error: formatUserError("display_revoked") }, { status: 404 });
    }
    return NextResponse.json(snapshot);
  } catch {
    reportError({ context: "display_snapshot", message: "Display snapshot failed", timestamp: new Date().toISOString() });
    return NextResponse.json({ error: formatUserError("display_revoked") }, { status: 500 });
  }
}
