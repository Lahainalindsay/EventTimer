import { createClient } from "@supabase/supabase-js";

export function getSupabaseSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("Missing server Supabase secret. Set SUPABASE_SECRET_KEY.");
  }
  return key;
}

export function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("Missing Supabase URL. Set NEXT_PUBLIC_SUPABASE_URL.");
  }
  return url;
}

export function createSupabaseServiceClient() {
  return createClient(getSupabaseUrl(), getSupabaseSecretKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
