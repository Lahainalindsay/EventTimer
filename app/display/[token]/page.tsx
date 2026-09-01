import { notFound } from "next/navigation";
import { DisplayClient } from "@/components/event-timer/display-client";
import { loadDisplaySnapshot } from "@/lib/display-snapshot";
import { reportError } from "@/lib/observability";
import { createSupabaseServiceClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function getDisplayData(token: string) {
  try {
    return await loadDisplaySnapshot(createSupabaseServiceClient(), token, true);
  } catch {
    reportError({ context: "display_token_verify", message: "Display token verification failed", timestamp: new Date().toISOString() });
    return null;
  }
}

export default async function DisplayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getDisplayData(token);
  if (!data?.token) notFound();
  return <DisplayClient initialData={{ ...data, token: data.token }} />;
}
