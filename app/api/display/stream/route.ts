import { NextRequest } from "next/server";
import { loadDisplaySnapshot } from "@/lib/display-snapshot";
import { reportError } from "@/lib/observability";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

const STREAM_INTERVAL_MS = 1000;

export async function POST(request: NextRequest) {
  let body: { token?: string };
  try {
    body = (await request.json()) as { token?: string };
  } catch {
    return new Response("unauthorized\n", { status: 400 });
  }

  if (!body.token || typeof body.token !== "string") {
    return new Response("unauthorized\n", { status: 400 });
  }

  let supabase;
  try {
    supabase = createSupabaseServiceClient();
  } catch {
    reportError({ context: "display_stream", message: "Missing service role configuration", timestamp: new Date().toISOString() });
    return new Response("unauthorized\n", { status: 500 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };
      const writeSnapshot = async () => {
        if (closed) return;
        const snapshot = await loadDisplaySnapshot(supabase, body.token ?? "", false);
        if (!snapshot) {
          controller.enqueue(encoder.encode(JSON.stringify({ type: "revoked" }) + "\n"));
          close();
          return;
        }
        controller.enqueue(encoder.encode(JSON.stringify({ type: "snapshot", snapshot }) + "\n"));
      };

      try {
        await writeSnapshot();
      } catch {
        reportError({ context: "display_stream", message: "Initial display stream snapshot failed", timestamp: new Date().toISOString() });
        close();
        return;
      }

      const interval = setInterval(() => {
        void writeSnapshot().catch(() => {
          reportError({ context: "display_stream", message: "Display stream snapshot failed", timestamp: new Date().toISOString() });
          close();
          clearInterval(interval);
        });
      }, STREAM_INTERVAL_MS);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        close();
      }, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/x-ndjson",
    },
  });
}
